import express, { Request, Response, Application, NextFunction } from "express";
import pino, { Logger } from "pino";
import pinoHttp from "pino-http";
import promClient from "prom-client";

import { createAgent, TAgent } from "@veramo/core";
import { DIDResolverPlugin } from "@veramo/did-resolver";
import { CredentialPlugin, ICredentialVerifier } from "@veramo/credential-w3c";
import { Resolver, DIDResolver, DIDResolutionResult } from "did-resolver";
import { getDidKeyResolver } from "@veramo/did-provider-key";
import { getResolver as getEthrResolver } from "ethr-did-resolver";
import { getResolver as getWebResolver } from "web-did-resolver";
import { LRUCache } from "lru-cache";
import * as dotenv from 'dotenv';
dotenv.config();

interface CacheOptions {
  max?: number;
  ttl?: number;
}

interface ResolverCacheConfig {
  ethr?: boolean;
  web?: boolean;
  key?: boolean;
}

interface VerifyCredentialRequest {
  credential: any;
}

// Prometheus Metrics Setup
class PrometheusMetrics {
  private METRIC_PREFIX = "credential_verifier_";
  private static instance: PrometheusMetrics;

  // Registry for all metrics
  private register: promClient.Registry;

  // HTTP Metrics
  public httpRequestDuration: promClient.Histogram<string>;
  public httpRequestTotal: promClient.Counter<string>;
  public httpRequestSize: promClient.Histogram<string>;
  public httpResponseSize: promClient.Histogram<string>;
  public activeConnections: promClient.Gauge<string>;

  // Business Logic Metrics
  public credentialVerificationDuration: promClient.Histogram<string>;
  public credentialVerificationTotal: promClient.Counter<string>;
  public didResolutionDuration: promClient.Histogram<string>;
  public didResolutionTotal: promClient.Counter<string>;
  public cacheHitTotal: promClient.Counter<string>;

  // System Metrics
  public processUptime: promClient.Gauge<string>;
  public processMemoryUsage: promClient.Gauge<string>;
  public processCpuUsage: promClient.Gauge<string>;

  private getSSIValidation(): string {
    const val = (process.env.SSI_VALIDATION || "")?.toLowerCase();
    const truthy = new Set(["1", "t", "true", "yes", "y"]);
    const falsy = new Set(["0", "f", "false", "no", "n"]);
    if (truthy.has(val)) return "true";
    if (falsy.has(val)) return "false";
    return "true";
  }

  constructor() {
    this.register = new promClient.Registry();

    // Enable default metrics (CPU, memory, event loop lag, etc.)
    promClient.collectDefaultMetrics({
      register: this.register,
      prefix: this.METRIC_PREFIX,
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
    });
    const didProvider = process.env.DID_PROVIDER || 'did:key';
    const ssiValidation = this.getSSIValidation();
    const truthy = new Set(["1", "t", "true", "yes", "y"])
    const cacheDid = didProvider.startsWith("did:ethr") ||
      truthy.has((process.env.CACHE_DID || "false").toLowerCase()) ? "true" : "false"
    const processingMode = process.env.PROCESSING_MODE == "async" ? "async" : "sync"

    this.register.setDefaultLabels({
      did_provider: didProvider,
      ssi_validation: ssiValidation,
      cache_did: cacheDid,
      processing_mode: processingMode,
    });

    this.initializeMetrics();
    setInterval(() => {
      this.updateSystemMetrics()
    }, 15000)
  }

  metricName(name: string) {
    return `${this.METRIC_PREFIX}${name}`;
  }

  static getInstance(): PrometheusMetrics {
    if (!PrometheusMetrics.instance) {
      PrometheusMetrics.instance = new PrometheusMetrics();
    }
    return PrometheusMetrics.instance;
  }

  private initializeMetrics(): void {
    // HTTP Request Duration
    this.httpRequestDuration = new promClient.Histogram({
      name: this.metricName("http_request_duration_seconds"),
      help: "Duration of HTTP requests in seconds",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.register],
    });

    // HTTP Request Total
    this.httpRequestTotal = new promClient.Counter({
      name: this.metricName("http_requests_total"),
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status_code"],
      registers: [this.register],
    });

    // HTTP Request Size
    this.httpRequestSize = new promClient.Histogram({
      name: this.metricName("http_request_size_bytes"),
      help: "Size of HTTP requests in bytes",
      labelNames: ["method", "route"],
      buckets: [100, 1000, 10000, 100000, 1000000],
      registers: [this.register],
    });

    // HTTP Response Size
    this.httpResponseSize = new promClient.Histogram({
      name: this.metricName("http_response_size_bytes"),
      help: "Size of HTTP responses in bytes",
      labelNames: ["method", "route", "status_code"],
      buckets: [100, 1000, 10000, 100000, 1000000],
      registers: [this.register],
    });

    // Active Connections
    this.activeConnections = new promClient.Gauge({
      name: this.metricName("http_active_connections"),
      help: "Number of active HTTP connections",
      registers: [this.register],
    });

    // Credential Verification Duration
    this.credentialVerificationDuration = new promClient.Histogram({
      name: this.metricName("credential_verification_duration_seconds"),
      help: "Duration of credential verification operations",
      labelNames: ["result"],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.register],
    });

    // Credential Verification Total
    this.credentialVerificationTotal = new promClient.Counter({
      name: this.metricName("credential_verifications_total"),
      help: "Total number of credential verification attempts",
      labelNames: ["result"],
      registers: [this.register],
    });

    // DID Resolution Duration
    this.didResolutionDuration = new promClient.Histogram({
      name: this.metricName("did_resolution_duration_seconds"),
      help: "Duration of DID resolution operations",
      labelNames: ["method", "cached"],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.register],
    });

    // DID Resolution Total
    this.didResolutionTotal = new promClient.Counter({
      name: this.metricName("did_resolutions_total"),
      help: "Total number of DID resolution attempts",
      labelNames: ["method", "cached", "result"],
      registers: [this.register],
    });

    // Cache Hit Rate
    this.cacheHitTotal = new promClient.Counter({
      name: this.metricName("cache_operations_total"),
      help: "Total number of cache operations",
      labelNames: ["operation", "result"],
      registers: [this.register],
    });

    // Process Uptime
    this.processUptime = new promClient.Gauge({
      name: this.metricName("process_uptime_seconds"),
      help: "Process uptime in seconds",
      registers: [this.register],
    });

    // Process Memory Usage
    this.processMemoryUsage = new promClient.Gauge({
      name: this.metricName("process_memory_usage_bytes"),
      help: "Process memory usage in bytes",
      labelNames: ["type"],
      registers: [this.register],
    });

    // Process CPU Usage
    this.processCpuUsage = new promClient.Gauge({
      name: this.metricName("process_cpu_usage_percent"),
      help: "Process CPU usage percentage",
      registers: [this.register],
    });
  }

  // Update system metrics every 15 seconds
  getRegistry(): promClient.Registry {
    return this.register;
  }

  private updateSystemMetrics(): void {
    // Update uptime
    this.processUptime.set(process.uptime());

    // Update memory usage
    const memUsage = process.memoryUsage();
    this.processMemoryUsage.set({ type: "rss" }, memUsage.rss);
    this.processMemoryUsage.set({ type: "heapTotal" }, memUsage.heapTotal);
    this.processMemoryUsage.set({ type: "heapUsed" }, memUsage.heapUsed);
    this.processMemoryUsage.set({ type: "external" }, memUsage.external);

    // Update CPU usage
    const cpuUsage = process.cpuUsage();
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    this.processCpuUsage.set(totalCpuTime / 1000000); // Convert microseconds to seconds
  }
}

export class CachedDidResolver {
  private metrics: PrometheusMetrics;
  constructor() {
    this.metrics =  PrometheusMetrics.getInstance()
  }

  private createCachedDIDResolver(
    baseResolver: DIDResolver,
    cacheOptions: CacheOptions = {}
  ): DIDResolver {
    const cache = new LRUCache<string, DIDResolutionResult>({
      max: cacheOptions.max || 100,
      ttl: cacheOptions.ttl || 1000 * 60 * 10,
    });

    const wrappedResolver: DIDResolver = async (
      did: string,
      parsed: any,
      resolver: any,
      options: any = {}
    ): Promise<DIDResolutionResult> => {
      const startTime = Date.now();
      const method = did.split(":")[1] || "unknown";

      try {
        const key = JSON.stringify({ did, options });
        const cached = cache.get(key);

        console.log("\n\n")
        console.log("CHECKING CACHE")
        if (cached) {
          // Cache hit
          const duration = (Date.now() - startTime) / 1000;
          this.metrics.didResolutionDuration.observe(
            { method, cached: "true" },
            duration
          );
          this.metrics.didResolutionTotal.inc({
            method,
            cached: "true",
            result: "success",
          });
          this.metrics.cacheHitTotal.inc({ operation: "get", result: "hit" });
          return cached;
        }
        console.log("Updating cache")

        // Cache miss
        this.metrics.cacheHitTotal.inc({ operation: "get", result: "miss" });

        const result = await baseResolver(did, parsed, resolver, options);

        cache.set(key, result);
        this.metrics.cacheHitTotal.inc({ operation: "set", result: "success" });

        const duration = (Date.now() - startTime) / 1000;
        this.metrics.didResolutionDuration.observe(
          { method, cached: "false" },
          duration
        );
        this.metrics.didResolutionTotal.inc({
          method,
          cached: "false",
          result: "success",
        });

        return result;
      } catch (e) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.didResolutionDuration.observe(
          { method, cached: "false" },
          duration
        );
        this.metrics.didResolutionTotal.inc({
          method,
          cached: "false",
          result: "error",
        });

        console.log("Error while accessing cache");
        console.error(e);
        throw e;
      }
    };

    return wrappedResolver;
  }

  private resolverWrapper(
    baseResolver: DIDResolver,
  ): DIDResolver {
    const wrappedResolver: DIDResolver = async (
      did: string,
      parsed: any,
      resolver: any,
      options: any = {}
    ): Promise<DIDResolutionResult> => {
      const startTime = Date.now();
      const method = did.split(":")[1] || "unknown";

      try {
        const result = await baseResolver(did, parsed, resolver, options);
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.didResolutionDuration.observe(
          { method, cached: "false" },
          duration
        );
        this.metrics.didResolutionTotal.inc({
          method,
          cached: "false",
          result: "success",
        });

        return result;
      } catch (e) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.didResolutionDuration.observe(
          { method, cached: "false" },
          duration
        );
        this.metrics.didResolutionTotal.inc({
          method,
          cached: "false",
          result: "error",
        });

        console.log("Error while accessing cache");
        console.error(e);
        throw e;
      }
    };

    return wrappedResolver;
  }

  createCachedResolvers(
    resolvers: Record<string, DIDResolver>,
    cacheOptions: CacheOptions = {},
    skipCache: string[] = []
  ): Record<string, DIDResolver> {
    const cachedResolvers: Record<string, DIDResolver> = {};

    for (const [method, resolver] of Object.entries(resolvers)) {
      if (skipCache.includes(method)) {
        cachedResolvers[method] = this.resolverWrapper(resolver);
      } else {
        cachedResolvers[method] = this.createCachedDIDResolver(
          resolver,
          cacheOptions
        );
      }
    }

    return cachedResolvers;
  }
}

class DidResolverFactory {
  private readonly infuraId: string | undefined;
  private readonly cachedDidResolver: CachedDidResolver;
  private readonly cacheConfig: ResolverCacheConfig;

  constructor(
    infuraId?: string,
    cacheConfig?: ResolverCacheConfig,
  ) {
    this.infuraId = infuraId;
    this.cachedDidResolver = new CachedDidResolver();

    // Default cache config: ethr is always cached if included, web and key are not cached
    const defaultConfig: ResolverCacheConfig = {
      ethr: true,
      web: false,
      key: false,
    };

    this.cacheConfig = { ...defaultConfig, ...cacheConfig };

    if (!infuraId) {
      console.warn(
        "INFURA_PROJECT_ID not set; did:ethr resolver will be excluded"
      );
    }
  }

  createResolver(): Resolver {
    const webDidResolver = getWebResolver();
    const didKeyResolver = getDidKeyResolver();

    // Build resolvers object, conditionally including ethr resolver
    const allResolvers: Record<string, DIDResolver> = {
      ...webDidResolver,
      ...didKeyResolver,
    };

    // Determine which resolvers to skip caching
    const skipCache: string[] = [];
    if (!this.cacheConfig.web) {
      skipCache.push(...Object.keys(webDidResolver));
    }
    if (!this.cacheConfig.key) {
      skipCache.push(...Object.keys(didKeyResolver));
    }

    // Only add ethr resolver if infuraId is provided
    if (this.infuraId) {
      const ethrDidResolver = getEthrResolver({
        infuraProjectId: this.infuraId,
        networks: [
          {
            name: "goerli",
            rpcUrl: `https://goerli.infura.io/v3/${this.infuraId}`,
          },
          {
            name: "mainnet",
            rpcUrl: `https://mainnet.infura.io/v3/${this.infuraId}`,
          },
          {
            name: "sepolia",
            rpcUrl: `https://sepolia.infura.io/v3/${this.infuraId}`,
            registry: '0x03d5003bf0e79C5F5223588F347ebA39AfbC3818',
          },
        ],
      });
      Object.assign(allResolvers, ethrDidResolver);
      if (!this.cacheConfig.ethr) {
        skipCache.push(...Object.keys(ethrDidResolver));
      }
    }

    // Create cached/non-cached resolvers based on configuration
    const resolvers = this.cachedDidResolver.createCachedResolvers(
      allResolvers,
      {},
      skipCache
    );

    return new Resolver(resolvers);
  }
}

class VeramoAgentFactory {
  static createAgent(didResolver: Resolver): TAgent<ICredentialVerifier> {
    return createAgent({
      plugins: [
        new DIDResolverPlugin({ resolver: didResolver }),
        new CredentialPlugin(),
      ],
    });
  }
}

class VerificationController {
  private metrics: PrometheusMetrics;
  constructor(
    private agent: TAgent<ICredentialVerifier>,
    private logger: Logger,
  ) {
    this.metrics = PrometheusMetrics.getInstance();
  }

  async verifyCredential(
    req: Request<{}, any, VerifyCredentialRequest>,
    res: Response
  ) {
    const startTime = Date.now();
    const { credential } = req.body || {};

    if (!credential) {
      this.metrics.credentialVerificationTotal.inc({ result: "invalid_input" });
      return res.status(400).json({ error: "credential is required" });
    }

    try {
      const result = await this.agent.verifyCredential({ credential });

      const duration = (Date.now() - startTime) / 1000;
      const resultLabel = result.verified ? "success" : "failed";

      this.metrics.credentialVerificationDuration.observe(
        { result: resultLabel },
        duration
      );
      this.metrics.credentialVerificationTotal.inc({ result: resultLabel });

      return res.json(result);
    } catch (e) {
      const duration = (Date.now() - startTime) / 1000;
      this.metrics.credentialVerificationDuration.observe(
        { result: "error" },
        duration
      );
      this.metrics.credentialVerificationTotal.inc({ result: "error" });

      req.log.error({ err: e }, "agent/verifyCredential failed");
      return res.status(400).json({
        verified: false,
        error: String((e as Error)?.message || e),
      });
    }
  }
}

// Prometheus middleware for HTTP metrics
function createPrometheusMiddleware() {
  const metrics = PrometheusMetrics.getInstance()
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Track active connections
    metrics.activeConnections.inc();

    // Track request size
    const requestSize = parseInt(req.headers["content-length"] || "0", 10);
    if (requestSize > 0) {
      metrics.httpRequestSize.observe(
        {
          method: req.method,
          route: req.route?.path || req.path,
        },
        requestSize
      );
    }

    // Override res.end to capture response metrics
    const originalEnd = res.end;
    res.end = function (
      this: Response,
      chunk?: any,
      encoding?: any
    ): Response<any, Record<string, any>> {
      const duration = (Date.now() - startTime) / 1000;
      const route = req.route?.path || req.path;
      const statusCode = res.statusCode.toString();

      // Record metrics
      metrics.httpRequestDuration.observe(
        {
          method: req.method,
          route,
          status_code: statusCode,
        },
        duration
      );

      metrics.httpRequestTotal.inc({
        method: req.method,
        route,
        status_code: statusCode,
      });

      // Track response size if available
      const responseSize = parseInt(
        (res.getHeader("content-length") as string) || "0",
        10
      );
      if (responseSize > 0) {
        metrics.httpResponseSize.observe(
          {
            method: req.method,
            route,
            status_code: statusCode,
          },
          responseSize
        );
      }

      // Decrease active connections
      metrics.activeConnections.dec();

      // Call original end method
      return originalEnd.call(this, chunk, encoding);
    };

    next();
  };
}

class VeramoServer {
  private app: Application;
  private logger: Logger;
  private agent: TAgent<ICredentialVerifier>;
  private controller: VerificationController;
  private metrics: PrometheusMetrics;

  constructor() {
    this.metrics = PrometheusMetrics.getInstance()
    this.logger = pino({ level: process.env.LOG_LEVEL || "info" });
    this.app = express();

    const didMethod = (process.env.DID_PROVIDER || "did:key").split(":").pop();
    const truthy = new Set(["1", "t", "true", "yes", "y"])
    const cacheDid = truthy.has((process.env.CACHE_DID || "false").toLowerCase());

    const cacheConfig = {}
    if(didMethod == "key" || didMethod == "web"){
      cacheConfig[didMethod] = cacheDid
    }

    // Setup DID resolver with cache configuration
    const resolverFactory = new DidResolverFactory(
      process.env.INFURA_PROJECT_ID,
      cacheConfig,
    );
    const didResolver = resolverFactory.createResolver();

    // Setup Veramo agent
    this.agent = VeramoAgentFactory.createAgent(didResolver);

    // Setup controller
    this.controller = new VerificationController(
      this.agent,
      this.logger,
    );

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Prometheus metrics middleware (before other middleware)
    this.app.use(createPrometheusMiddleware());

    this.app.use(
      express.json({
        limit: "2mb",
        type: ["application/json", "application/*+json"],
      })
    );
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(pinoHttp({ logger: this.logger }));
  }

  private setupRoutes(): void {
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    // Prometheus metrics endpoint
    this.app.get("/metrics", async (_req: Request, res: Response) => {
      try {
        res.set("Content-Type", this.metrics.getRegistry().contentType);
        res.end(await this.metrics.getRegistry().metrics());
      } catch (ex) {
        res.status(500).end(ex);
      }
    });

    this.app.post("/agent/verifyCredential", (req, res) => {
      this.controller.verifyCredential(req, res);
    });
  }

  start(port?: number): void {
    const PORT = port || parseInt(process.env.PORT || "4321");

    this.app.listen(PORT, () => {
      this.logger.info({ port: PORT }, "Veramo verify server listening");
      this.logger.info(
        { port: PORT },
        "Prometheus metrics available at /metrics"
      );
    });
  }
}

// Start the server
const server = new VeramoServer();
server.start();
