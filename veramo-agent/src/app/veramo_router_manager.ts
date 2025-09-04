import {
  AgentRouter,
  ApiSchemaRouter,
  WebDidDocRouter,
  MessagingRouter,
} from "@veramo/remote-server";
import { IAgent } from "@veramo/core";
import { ExplorerRouter } from "agent-explore";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { ServerConfig, exposedMethods, ExplorerConfig } from "../config";
import PrometheusMetrics from '../monitoring/metrics';
import { ModifyOpenAPISchema } from "./modify_open_api_schema/veramo_modify_schema";
import { DualAuthApiSchemaModifier } from "./modify_open_api_schema/dual_auth_api_schema_modifier";
import { veramoDualAuthMethods } from "../config/app.config";

export default class VeramoRouterManager {
  private config: ServerConfig;
  private agent: IAgent;
  private metrics: PrometheusMetrics

  constructor(config: ServerConfig, veramoAgent: IAgent) {
    this.config = config;
    this.agent = veramoAgent;
    this.metrics = PrometheusMetrics.getInstance()
  }

  setupWebDidDocRouter(): express.Router {
    return WebDidDocRouter({});
  }

  setupMessagingRouter(): express.Router {
    return MessagingRouter({
      metaData: {
        type: "DIDComm",
        value: "https",
      },
    });
  }

  setupAgentRouter(): express.Router {
    return AgentRouter({
      exposedMethods: exposedMethods,
    });
  }

  setupEnhancedApiRouter(): express.Router {
    const modifyOpenAPISchema = new ModifyOpenAPISchema({
      agent:this.agent,
      basePath: `:${this.config.port}/agent`,
      exposedMethods: exposedMethods,
      apiName: "Enhanced Veramo Agent",
      apiVersion: "1.0.0",
    });

    const dualAuth = new DualAuthApiSchemaModifier({
      exposedMethods: exposedMethods,
      dualAuthMethods: veramoDualAuthMethods,
      primaryAuthName: "auth",
      secondaryAuthName: "x-authorization",
      secondaryAuthDescription: "Authorization Credential JWT for issuer authorization",
    });
    return modifyOpenAPISchema.modifySchema([dualAuth]);
  }


  setupApiSchemaRouter(): express.Router {
    return ApiSchemaRouter({
      basePath: `:${this.config.port}/agent`,
      securityScheme: "bearer",
      apiName: "Agent",
      apiVersion: "1.0.0",
      exposedMethods: exposedMethods,
    });
  }

  setupSwaggerRouter(): {
    serve: express.RequestHandler[];
    setup: express.RequestHandler;
  } {
    return {
      serve: swaggerUi.serve,
      setup: swaggerUi.setup(null, {
        swaggerOptions: {
          url: "/open-api.json",
          ...this.config.swaggerOptions,
        },
      }),
    };
  }

  setupMetricsRouter(): express.Router {
    return express.Router().get("/", async (req, res) => {
      res.set("Content-Type", this.metrics.getRegistry().contentType);
      res.end(await this.metrics.getRegistry().metrics());
    });
  }

  verifyJWTAndVCStoreSignature(): express.RequestHandler {
    return (req, res, next) => {
      // Middleware logic to verify JWT and VC store signature
      // This is a placeholder; actual implementation will depend on your requirements
      console.log("Verifying JWT and VC store signature...");
      next();
    };
  }

  setupExplorerRouter(explorerConfigs: ExplorerConfig[]): express.Router {
    return ExplorerRouter(explorerConfigs);
  }
}
