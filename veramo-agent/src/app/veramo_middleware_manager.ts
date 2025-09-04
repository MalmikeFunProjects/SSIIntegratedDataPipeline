import { RequestWithAgentRouter, apiKeyAuth } from "@veramo/remote-server";
import { Request, Response, NextFunction, RequestHandler } from "express";
import PrometheusMetrics from "../monitoring/metrics";

import cors from "cors";
import { TAgent } from "@veramo/core";

import { veramoDualAuthMethods } from "../config/app.config";
import { VeramoDualAuthMethod } from "../config";

const DUAL_AUTH_SET = new Set<string>(veramoDualAuthMethods);

export default class VeramoMiddlewareManager {
  private agent: TAgent<any>;
  private metrics: PrometheusMetrics;

  constructor(agent: TAgent<any>) {
    this.agent = agent;
    this.metrics = PrometheusMetrics.getInstance();
  }

  setupCORS(corsOptions?: cors.CorsOptions): RequestHandler {
    return cors(corsOptions);
  }

  setupAgentMiddleware(): RequestHandler {
    return RequestWithAgentRouter({ agent: this.agent });
  }

  setupAuthentication(apiKey: string): RequestHandler {
    const authMiddleware = apiKeyAuth({ apiKey });
    return (req: Request, res: Response, next: NextFunction) => {
      authMiddleware(req, res, (err?: any) => {
        const status = err ? "failed" : "success";

        // Record authentication metrics
        this.metrics.authenticationAttempts.inc({ type: "api_key", status });
        if (err) {
          this.metrics.agentErrors.inc({
            method: "authentication",
            error_type: "api_key_invalid",
          });
        }
        next(err);
      });
    };
  }

  private getRoutePattern(path: string): string {
    // Normalize route patterns for consistent metrics
    if (path.startsWith("/agent/")) return "/agent/*";
    if (path.startsWith("/messaging/")) return "/messaging/*";
    if (path.startsWith("/api-docs")) return "/api-docs";
    if (path === "/open-api.json") return "/open-api.json";
    if (path === "/health") return "/health";
    if (path === "/metrics") return "/metrics";
    return path;
  }

  // Enhanced HTTP metrics middleware
  setupHttpMetrics(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      // Track active connections
      this.metrics.activeConnections.inc()

      const route = this.getRoutePattern(req.path);

      // Track request size
      if (req.get("content-length")) {
        this.metrics.httpRequestSize.observe(
          { method: req.method, route },
          parseInt(req.get("content-length") || "0")
        );
      }
      const metrics = this.metrics;

      // Override res.end to capture response metrics
      const originalEnd = res.end;
      res.end = function (
        this: Response,
        chunk?: any,
        encoding?: any
      ): Response<any, Record<string, any>> {
        const duration = (Date.now() - startTime) / 1000;

        // Record HTTP metrics
        const labels = {
          method: req.method,
          route,
          status_code: res.statusCode.toString(),
        };
        metrics.httpRequestDuration.observe(labels, duration);
        metrics.httpRequestTotal.inc(labels);

        // Track response size
        if (res.get("content-length")) {
          metrics.httpResponseSize.observe(
            labels,
            parseInt(res.get("content-length") || "0")
          );
        }
        // Decrease active connections
        metrics.activeConnections.dec()

        return originalEnd.call(this, chunk, encoding);
      };

      next();
    };
  }

  private getBearer(
    req: Request,
    headerName = "x-authorization"
  ): string | null {
    const header = req.get(headerName);
    if (!header) return null;
    const [scheme, token] = header.split(" ");
    if (!/^Bearer$/i.test(scheme) || !token) return null;
    return token;
  }

  private extractDid(
    method: VeramoDualAuthMethod,
    args: any
  ): string | string[] | undefined {
    switch (method) {
      case "didManagerAddKey":
      case "didManagerRemoveKey":
      case "didManagerAddService":
      case "didManagerRemoveService":
      case "didManagerDelete":
        return args?.did;

      case "createVerifiableCredential":
        return args?.credential?.issuer?.id;

      case "createVerifiablePresentation":
        return args?.presentation?.verifiableCredential
          ?.map((vc: any) => vc?.issuer?.id)
          .filter(Boolean);

      case "dataStoreSaveVerifiableCredential":
        return args?.verifiableCredential?.issuer?.id;

      case "dataStoreSaveVerifiablePresentation":
        return args?.verifiablePresentation?.verifiableCredential
          ?.map((vc: any) => vc?.issuer?.id)
          .filter(Boolean);

      default:
        return undefined;
    }
  }

  checkAuthorisationToken(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      const methodName = req.path.split("/").filter(Boolean).pop();
      const timer = this.metrics.measureDuration(
        this.metrics.authorizationDuration,
        { method: methodName || "unknown", status: "pending" }
      );

      // If the method requires dual authentication, check for the authorization header
      if (methodName && DUAL_AUTH_SET.has(methodName)) {
        this.metrics.dualAuthChecks.inc({
          method: methodName,
          status: "attempted",
        });
        const credentialJWT = this.getBearer(req, "x-authorization");
        if (!credentialJWT) {
          timer.endWith({ status: "failed" });
          this.metrics.authorizationChecks.inc({
            method: methodName,
            status: "failed",
          });
          this.metrics.dualAuthChecks.inc({
            method: methodName,
            status: "no_header",
          });
          return res.status(401).json({
            error: "Unauthorized",
            message:
              "Authorization Credential header is required for this method.",
          });
        }

        const verifiableCredential =
          await this.agent.dataStoreGetVerifiableCredential({
            hash: credentialJWT,
          });

        if (!verifiableCredential) {
          timer.endWith({ status: "failed" });
          this.metrics.authorizationChecks.inc({
            method: methodName,
            status: "invalid_credential",
          });
          this.metrics.dualAuthChecks.inc({
            method: methodName,
            status: "invalid_credential",
          });
          return res.status(401).json({
            error: "Unauthorized",
            message: "Invalid Authorization Credential.",
          });
        }

        const did = this.extractDid(
          methodName as VeramoDualAuthMethod,
          req.body?.args || req.body
        );
        if (!did) {
          timer.endWith({ status: "failed" });
          this.metrics.authorizationChecks.inc({
            method: methodName,
            status: "no_did",
          });
          this.metrics.dualAuthChecks.inc({
            method: methodName,
            status: "no_did",
          });
          return res.status(400).json({
            error: "Bad Request",
            message: "DID not found in request body.",
          });
        }

        const isAuthorized = await this.agent.verifyDidGrant({
          did,
          authorisationCredential: verifiableCredential,
          requiredPermissions: [methodName],
        });

        if (!isAuthorized || !isAuthorized.valid) {
          timer.endWith({ status: "forbidden" });
          this.metrics.authorizationChecks.inc({
            method: methodName,
            status: "forbidden",
          });
          this.metrics.dualAuthChecks.inc({
            method: methodName,
            status: "forbidden",
          });
          return res.status(403).json({
            error: "Forbidden",
            message: "You do not have permission to perform this action.",
          });
        }
        timer.endWith({ status: "success" });
        this.metrics.authorizationChecks.inc({
          method: methodName,
          status: "success",
        });
        this.metrics.dualAuthChecks.inc({
          method: methodName,
          status: "success",
        });
      } else {
        timer.endWith({ status: "skipped" });
        this.metrics.authorizationChecks.inc({
          method: methodName || "unknown",
          status: "skipped",
        });
      }
      next();
    };
  }
}
