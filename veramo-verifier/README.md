# Veramo Verifier

A lightweight, production-ready HTTP service for verifying W3C Verifiable Credentials (VCs) using Veramo with DID resolution, optional LRU caching, structured Pino logging, and Prometheus metrics.

## Features

- **/agent/verifyCredential** endpoint to verify W3C VCs via Veramo's `CredentialPlugin`
- **DID resolution** via `did-resolver` with support for:
  - `did:key` (built-in)
  - `did:web` (DNS/HTTPS hosted DID documents)
  - `did:ethr` (Infura-backed networks: mainnet, goerli, sepolia)
- **Configurable DID-doc caching** (LRU) per method with latency & hit/miss metrics
- **Rich Prometheus telemetry** for HTTP, verification, DID resolution, cache, and system stats
- **Health check** and metrics endpoints: `/health`, `/metrics`
- **Minimal container**: Node 20 Alpine, Dockerfile & Docker Compose provided

## Configuration

All configuration is via environment variables with sensible defaults.

| Variable            | Default   | Description                                                                                                                          |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`              | `4321`    | HTTP server port                                                                                                                     |
| `LOG_LEVEL`         | `info`    | Pino log level (`fatal`,`error`,`warn`,`info`,`debug`,`trace`)                                                                       |
| `DID_PROVIDER`      | `did:key` | Primary DID method context (`did:key`, `did:web`, or `did:ethr:sepolia` etc). Used for default labels and cache toggling for key/web |
| `INFURA_PROJECT_ID` | *unset*   | Enables `did:ethr` resolver (mainnet, goerli, sepolia). If not set, `did:ethr` is excluded                                           |
| `CACHE_DID`         | `false`   | **For `did:key` or `did:web`**: toggle LRU caching for the configured method. `did:ethr` is cached by default when enabled           |


### DID Resolver & Caching Rules

- **`did:ethr`**: Included **only** when `INFURA_PROJECT_ID` is set. **Cached by default** (to reduce network latency)
- **`did:key` / `did:web`**: **Not cached** by default. You can enable caching for the *selected* `DID_PROVIDER` method by setting `CACHE_DID=true`

> **Security note**: Do **not** commit real secrets in `.env`. Replace `INFURA_PROJECT_ID` with a placeholder in public repos.

## Getting Started

### Local Development

1. **Install dependencies**
   ```bash
   yarn install
   ```

2. **Configure environment**
   Update `sample.env` file and use it to create `.env`. If you are using docker the .env file is created from sample.env:
   ```env
   PORT=4321
   LOG_LEVEL=info
   DID_PROVIDER=did:key
   INFURA_PROJECT_ID=YOUR_INFURA_ID # Only needed for did:ethr:
   CACHE_DID=false
   ```

3. **Run the service**
   ```bash
   yarn start
   # or for development
   yarn dev
   ```

4. **Check that the service is running**
   ```bash
   curl -sS localhost:4321/health
   curl -sS localhost:4321/metrics | head
   ```

### Docker

**Build and run:**
```bash
docker build -t veramo-verifier .
docker run --rm -p 4321:4321 \
  -e PORT=4321 \
  -e LOG_LEVEL=info \
  -e DID_PROVIDER=did:key \
  -e CACHE_DID=false \
  -e SSI_VALIDATION=true \
  -e PROCESSING_MODE=sync \
  veramo-verifier
```

**Docker Compose example:**
```bash
docker compose up -d credential_verifier
```

## API Endpoints

### `GET /health`
Basic liveness check.
```json
{ "ok": true }
```

### `POST /agent/verifyCredential`
Verifies a Verifiable Credential.

**Request body:**
```json
{
  "credential": { /* a W3C Verifiable Credential object */ }
}
```

**Response (success):**
```json
{
  "verified": true,
  "checks": [ /* ... */ ],
  "error": null
}
```

**Response (failure):**
```json
{
  "verified": false,
  "error": "reason..."
}
```

**Example:**
```bash
curl -sS http://localhost:4321/agent/verifyCredential \
  -H 'content-type: application/json' \
  -d @credential.json
```

### `GET /metrics`
Exposes Prometheus metrics (see Metrics section below).

## Sample Verifiable Credential

```json
{
  "credential": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential"],
    "issuer": "did:key:z6Mk...",
    "issuanceDate": "2025-09-01T00:00:00Z",
    "credentialSubject": {
      "id": "did:web:example.org",
      "membership": "gold"
    },
    "proof": {
      "type": "Ed25519Signature2018",
      "created": "2025-09-01T00:00:00Z",
      "verificationMethod": "did:key:z6Mk...#z6Mk...",
      "proofPurpose": "assertionMethod",
      "jws": "eyJhbGciOiJFZERTQSIs..."
    }
  }
}
```

## Metrics

All metrics use the **`credential_verifier_`** prefix and include default labels:
- `did_provider` (from `DID_PROVIDER`, e.g., `did:key`)
- `ssi_validation` (`true`/`false` normalized)
- `cache_did` (`true` when caching enabled for selected method or when `did:ethr` is used)
- `processing_mode` (`sync`/`async` label only)

### HTTP Metrics
- `credential_verifier_http_request_duration_seconds{method,route,status_code}`
- `credential_verifier_http_requests_total{method,route,status_code}`
- `credential_verifier_http_request_size_bytes{method,route}`
- `credential_verifier_http_response_size_bytes{method,route,status_code}`
- `credential_verifier_http_active_connections`

### Business Metrics
- `credential_verifier_credential_verification_duration_seconds{result}`
- `credential_verifier_credential_verifications_total{result}`
- `credential_verifier_did_resolution_duration_seconds{method,cached}`
- `credential_verifier_did_resolutions_total{method,cached,result}`
- `credential_verifier_cache_operations_total{operation,result}`

### System Metrics
- `credential_verifier_process_uptime_seconds`
- `credential_verifier_process_memory_usage_bytes{type=rss|heapTotal|heapUsed|external}`
- `credential_verifier_process_cpu_usage_percent`
- Default Node process metrics via `prom-client.collectDefaultMetrics` (prefixed)

**Grafana Example:**
```promql
sum(rate(credential_verifier_did_resolutions_total{result="success"}[5m])) by (method,cached,did_provider)
```

## Architecture

### Project Layout
- `src/server.ts` — Express app, routes, middleware
- `CachedDidResolver` — LRU wrapper with Prometheus timings & hit/miss counters
- `DidResolverFactory` — Builds a `did-resolver` with optional caching per method
- `VeramoAgentFactory` — Creates a Veramo agent with DID resolution & credential plugin
- `PrometheusMetrics` — Centralizes registry, default labels, and instruments HTTP, verifier, resolver, cache, and process stats

### Tech Stack
- **Veramo**: `@veramo/core`, `@veramo/credential-w3c`, `@veramo/did-resolver`
- **DID resolvers**: `did-resolver`, `web-did-resolver`, `ethr-did-resolver`, `@veramo/did-provider-key`
- **Server**: `express` (v5)
- **Logging**: `pino`, `pino-http`
- **Metrics**: `prom-client`
- **Cache**: `lru-cache`
- **Runtime**: Node 20, TypeScript via `tsx`

## Performance Tuning

- **Enable caching** for high Queries Per Second for DID methods:
  - `did:ethr`: always cached when utilising this DID method
  - `did:web` / `did:key`: set `CACHE_DID=true` with the corresponding `DID_PROVIDER`
- **Right-size** LRU cache: defaults are `max=100`, `ttl=10m`. (Adjust in `CachedDidResolver` if needed)
- Scrape `/metrics` every 15s to match the internal system metric update cadence

## Troubleshooting

**`did:ethr` resolution not working**
Ensure `INFURA_PROJECT_ID` is set and the network you use (e.g., `sepolia`) is supported. The factory registers `mainnet`, `goerli`, `sepolia` with Infura RPCs.

**Verification fails with `verificationMethod` not found**
Confirm the issuer DID resolves correctly and that the DID document contains a matching verification method id.

**Large payloads rejected**
JSON body limit is `2mb`. Increase in `express.json({ limit: "2mb" })` if needed.

**Metrics missing**
Access `/metrics` directly. If empty or 500, check logs; ensure Prometheus scrapes the right path/port.

## Logging

Uses **pino** and **pino-http** with level controlled via `LOG_LEVEL`. Errors during verification are logged with context, and health/startup information includes the listening port and metrics path.

---

*Internal project scaffolding for VC verification services.*
