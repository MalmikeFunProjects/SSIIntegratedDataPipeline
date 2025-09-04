import { DIDResolver, DIDResolutionResult } from "did-resolver";
import { LRUCache } from "lru-cache";
import PrometheusMetrics from "../monitoring/metrics";

export class CachedDidResolver {
  private metrics: PrometheusMetrics;

  constructor() {
    this.metrics = PrometheusMetrics.getInstance();
  }

  private createCachedDIDResolver(
    baseResolver: DIDResolver,
    cacheOptions: { max?: number; ttl?: number } = {}
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
      const method = parsed?.method || "unknown";
      const timer = this.metrics.measureDuration(
        this.metrics.didResolutionDuration,
        { method, cached: "unknown" }
      );

      try {
        const key = JSON.stringify({ did, options });
        const cached = cache.get(key);

        if (cached) {
          // Cache hit
          timer.endWith({ cached: "true" });
          this.metrics.didCacheHits.inc({ method });
          return cached;
        }

        // Cache miss - resolve and cache
        timer.endWith({ cached: "false" });
        this.metrics.didCacheMisses.inc({ method });

        const resolveTimer = this.metrics.measureDuration(
          this.metrics.didOperationDuration,
          { operation: "resolve", provider: method, status: "pending" }
        );

        const result = await baseResolver(did, parsed, resolver, options);

        // Track resolution success/failure
        const status = result.didResolutionMetadata?.error
          ? "failed"
          : "success";
        resolveTimer.endWith({ status });
        this.metrics.didOperations.inc({
          operation: "resolve",
          provider: method,
          status,
        });

        if (!result.didResolutionMetadata?.error) {
          cache.set(key, result);
        }

        return result;
      } catch (e) {
        timer.endWith({ cached: "error" });
        this.metrics.didOperations.inc({
          operation: "resolve",
          provider: method,
          status: "error",
        });
        this.metrics.agentErrors.inc({
          method: "did_resolution",
          error_type: e instanceof Error ? e.constructor.name : "unknown",
        });

        console.log("Error while accessing DID resolver cache");
        console.error(e);
        throw e;
      }
    };

    return wrappedResolver;
  }

  createCachedResolvers(
    resolvers: Record<string, DIDResolver>,
    cacheOptions: { max?: number; ttl?: number } = {},
    skipCache: string[] = []
  ): Record<string, DIDResolver> {
    const cachedResolvers: Record<string, DIDResolver> = {};

    for (const [method, resolver] of Object.entries(resolvers)) {
      if (skipCache.includes(method)) {
        cachedResolvers[method] = resolver;
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
