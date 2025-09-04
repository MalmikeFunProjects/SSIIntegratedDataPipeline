import promClient from "prom-client";
import * as dotenv from 'dotenv';
dotenv.config();

export class PrometheusMetrics {
  private METRIC_PREFIX = "veramo_agent_";
  private static instance: PrometheusMetrics;
  private registry: promClient.Registry;

  // HTTP Request Metrics
  public httpRequestDuration!: promClient.Histogram<string>;
  public httpRequestTotal!: promClient.Counter<string>;
  public httpRequestSize!: promClient.Histogram<string>;
  public httpResponseSize!: promClient.Histogram<string>;

  // Authentication & Authorization Metrics
  public authenticationAttempts!: promClient.Counter<string>;
  public authorizationChecks!: promClient.Counter<string>;
  public authorizationDuration!: promClient.Histogram<string>;
  public dualAuthChecks!: promClient.Counter<string>;

  // DID Operations Metrics
  public didOperations!: promClient.Counter<string>;
  public didOperationDuration!: promClient.Histogram<string>;
  public didResolutionDuration!: promClient.Histogram<string>;
  public didCacheHits!: promClient.Counter<string>;
  public didCacheMisses!: promClient.Counter<string>;

  // Credential Operations Metrics
  public credentialOperations!: promClient.Counter<string>;
  public credentialOperationDuration!: promClient.Histogram<string>;
  public credentialVerifications!: promClient.Counter<string>;
  public credentialVerificationDuration!: promClient.Histogram<string>;

  // Agent Operations Metrics
  public agentMethodCalls!: promClient.Counter<string>;
  public agentMethodDuration!: promClient.Histogram<string>;
  public agentErrors!: promClient.Counter<string>;

  // System Metrics
  public activeConnections!: promClient.Gauge<string>;
  public memoryUsage!: promClient.Gauge<string>;
  public dbConnectionPoolSize!: promClient.Gauge<string>;


  private getSSIValidation(): string {
    const val = (process.env.SSI_VALIDATION || "")?.toLowerCase();
    const truthy = new Set(["1", "t", "true", "yes", "y"]);
    const falsy = new Set(["0", "f", "false", "no", "n"]);
    if (truthy.has(val)) return "true";
    if (falsy.has(val)) return "false";
    return "true";
  }

  private normalize = (v: string) => v.toLowerCase();

  private getDIDProvider(): string{
    return this.normalize(process.env.DID_PROVIDER || "did:key");
  }

  private getCacheDID(): string {
    const truthy = new Set(["1", "t", "true", "yes", "y"]);
    const didProvider = this.getDIDProvider()
    const cacheDid = truthy.has(this.normalize(process.env.CACHE_DID || "false"));
    return didProvider.startsWith("did:ethr") || cacheDid? "true": "false"
  }

  private getProcessingMode(): string {
    return this.normalize(process.env.PROCESSING_MODE || "sync") == "async" ? "async" : "sync"
  }

  constructor() {
    this.registry = new promClient.Registry();

    // Enable default metrics (CPU, memory, etc.)
    promClient.collectDefaultMetrics({
      register: this.registry,
      prefix: this.METRIC_PREFIX,
    });

    const didProvider = this.getDIDProvider();
    const ssiValidation = this.getSSIValidation();
    const cacheDid = this.getCacheDID();
    const processing_mode = this.getProcessingMode()

    this.registry.setDefaultLabels({
      did_provider: didProvider,
      ssi_validation: ssiValidation,
      cache_did: cacheDid,
      processing_mode: processing_mode,
    });

    this.initializeMetrics();
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
    // HTTP Request Metrics
    this.httpRequestDuration = new promClient.Histogram({
      name: this.metricName("http_request_duration_seconds"),
      help: "Duration of HTTP requests in seconds",
      labelNames: ["method", "route", "status_code"],
      buckets: [
        0.001, 0.005, 0.015, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 5, 10,
      ],
      registers: [this.registry],
    });

    this.httpRequestTotal = new promClient.Counter({
      name: this.metricName("http_requests_total"),
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status_code"],
      registers: [this.registry],
    });

    this.httpRequestSize = new promClient.Histogram({
      name: this.metricName("http_request_size_bytes"),
      help: "Size of HTTP requests in bytes",
      labelNames: ["method", "route"],
      buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
      registers: [this.registry],
    });

    this.httpResponseSize = new promClient.Histogram({
      name: this.metricName("http_response_size_bytes"),
      help: "Size of HTTP responses in bytes",
      labelNames: ["method", "route", "status_code"],
      buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
      registers: [this.registry],
    });

    // Authentication & Authorization Metrics
    this.authenticationAttempts = new promClient.Counter({
      name: this.metricName("authentication_attempts_total"),
      help: "Total number of authentication attempts",
      labelNames: ["type", "status"],
      registers: [this.registry],
    });

    this.authorizationChecks = new promClient.Counter({
      name: this.metricName("authorization_checks_total"),
      help: "Total number of authorization checks",
      labelNames: ["method", "status"],
      registers: [this.registry],
    });

    this.authorizationDuration = new promClient.Histogram({
      name: this.metricName("authorization_duration_seconds"),
      help: "Duration of authorization checks in seconds",
      labelNames: ["method", "status"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [this.registry],
    });

    this.dualAuthChecks = new promClient.Counter({
      name: this.metricName("dual_auth_checks_total"),
      help: "Total number of dual authentication checks",
      labelNames: ["method", "status"],
      registers: [this.registry],
    });

    // DID Operations Metrics
    this.didOperations = new promClient.Counter({
      name: this.metricName("did_operations_total"),
      help: "Total number of DID operations",
      labelNames: ["operation", "provider", "status"],
      registers: [this.registry],
    });

    this.didOperationDuration = new promClient.Histogram({
      name: this.metricName("did_operation_duration_seconds"),
      help: "Duration of DID operations in seconds",
      labelNames: ["operation", "provider", "status"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });

    this.didResolutionDuration = new promClient.Histogram({
      name: this.metricName("did_resolution_duration_seconds"),
      help: "Duration of DID resolution in seconds",
      labelNames: ["method", "cached"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [this.registry],
    });

    this.didCacheHits = new promClient.Counter({
      name: this.metricName("did_cache_hits_total"),
      help: "Total number of DID cache hits",
      labelNames: ["method"],
      registers: [this.registry],
    });

    this.didCacheMisses = new promClient.Counter({
      name: this.metricName("did_cache_misses_total"),
      help: "Total number of DID cache misses",
      labelNames: ["method"],
      registers: [this.registry],
    });

    // Credential Operations Metrics
    this.credentialOperations = new promClient.Counter({
      name: this.metricName("credential_operations_total"),
      help: "Total number of credential operations",
      labelNames: ["operation", "status"],
      registers: [this.registry],
    });

    this.credentialOperationDuration = new promClient.Histogram({
      name: this.metricName("credential_operation_duration_seconds"),
      help: "Duration of credential operations in seconds",
      labelNames: ["operation", "status"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.credentialVerifications = new promClient.Counter({
      name: this.metricName("credential_verifications_total"),
      help: "Total number of credential verifications",
      labelNames: ["status"],
      registers: [this.registry],
    });

    this.credentialVerificationDuration = new promClient.Histogram({
      name: this.metricName("credential_verification_duration_seconds"),
      help: "Duration of credential verifications in seconds",
      labelNames: ["status"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [this.registry],
    });

    // Agent Operations Metrics
    this.agentMethodCalls = new promClient.Counter({
      name: this.metricName("method_calls_total"),
      help: "Total number of agent method calls",
      labelNames: ["method", "status"],
      registers: [this.registry],
    });

    this.agentMethodDuration = new promClient.Histogram({
      name: this.metricName("method_duration_seconds"),
      help: "Duration of agent method calls in seconds",
      labelNames: ["method", "status"],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.agentErrors = new promClient.Counter({
      name: this.metricName("errors_total"),
      help: "Total number of agent errors",
      labelNames: ["method", "error_type"],
      registers: [this.registry],
    });

    // System Metrics
    this.activeConnections = new promClient.Gauge({
      name: this.metricName("active_connections"),
      help: "Number of active connections",
      registers: [this.registry],
    });

    this.memoryUsage = new promClient.Gauge({
      name: this.metricName("memory_usage_bytes"),
      help: "Memory usage in bytes",
      labelNames: ["type"],
      registers: [this.registry],
    });

    this.dbConnectionPoolSize = new promClient.Gauge({
      name: this.metricName("db_connection_pool_size"),
      help: "Database connection pool size",
      labelNames: ["status"],
      registers: [this.registry],
    });
  }

  getRegistry(): promClient.Registry {
    return this.registry;
  }

  // Utility method to measure function execution time
  measureDuration<T>(
    histogram: promClient.Histogram<string>,
    labels: Record<string, string | number>
  ) {
    const end = histogram.startTimer(labels);
    return {
      end: () => end(),
      endWith: (additionalLabels: Record<string, string | number> = {}) =>
        end({ ...labels, ...additionalLabels }),
    };
  }

  // Update system metrics periodically
  updateSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    this.memoryUsage.set({ type: "rss" }, memUsage.rss);
    this.memoryUsage.set({ type: "heapTotal" }, memUsage.heapTotal);
    this.memoryUsage.set({ type: "heapUsed" }, memUsage.heapUsed);
    this.memoryUsage.set({ type: "external" }, memUsage.external);
  }
}

export default PrometheusMetrics;
