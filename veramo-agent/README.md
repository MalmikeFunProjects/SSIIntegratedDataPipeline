# Veramo Agent

A production-ready **Veramo agent** that exposes a secure HTTP API for **DID management**, **VC issuance & verification**, **DID resolution**, and **DIDComm messaging**.

## Key Features

- **Dual-auth** security (API key + Authorization Credential for sensitive operations)
- **OpenAPI** with Swagger UI and Agent Explorer interface
- **Prometheus metrics** with rich labels for observability
- **DID resolution caching** with configurable TTL
- **did:web** bootstrapping via external helper service
- **SQLite (dev) / Postgres (prod)** database support

---

## Quick Start

### Using Docker Compose

```yaml
veramo_server:
  build:
    context: ./veramo-agent
    dockerfile: Dockerfile
  container_name: veramo_server
  ports:
    - "3332:3332"
  environment:
    PORT: 3332
    DID_PROVIDER: ${DID_PROVIDER:-did:key}
    API_KEY: ${API_KEY:-test123}
    SECRET_KEY: ${SECRET_KEY}
  volumes:
    - ./veramo-agent:/app
    - /app/node_modules
  depends_on:
    - db
    - host_did_web
  healthcheck:
    test: ["CMD-SHELL", "curl -f http://localhost:3332/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
```

```bash
docker compose up -d --build veramo_server
```

### Access the interfaces

- **API Documentation**: http://localhost:3332/api-docs
- **Agent Explorer**: http://localhost:3332/agent-explore
- **Health Check**: http://localhost:3332/health
- **Metrics**: http://localhost:3332/metrics

---

## Configuration

Copy `sample.env` to `.env` or set via Docker Compose environment variables.

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3332` | HTTP server port |
| `BASE_URL` | `http://localhost:3332` | External service URL |
| `API_KEY` | `test123` | Primary API authentication key |
| `SECRET_KEY` | *(required)* | KMS encryption key for database |
| `DEFAULT_PROVIDER` | `did:key` | Default DID method |

### Database Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | `development` uses SQLite, `production` uses Postgres |
| `SQLITE_DB_FILE` | `./db/database.sqlite` | SQLite database path (dev) |
| `DATABASE_URL` | *(required for prod)* | PostgreSQL connection string |

### DID Resolution

| Variable | Default | Description |
|----------|---------|-------------|
| `INFURA_PROJECT_ID` | *(required for did:ethr)* | Ethereum network access |
| `UNIVERSAL_RESOLVER_URL` | `https://uniresolver.io/1.0/identifiers` | Fallback resolver |
| `HOST_DID_WEB_URL` | `http://host_did_web:3999` | Helper service for did:web hosting |

### Performance & Monitoring

| Variable | Default | Description |
|----------|---------|-------------|
| `DID_PROVIDER` | `did:key` | Metrics label and cache behavior |
| `CACHE_DID` | `false` | Enable DID resolution caching |
| `SSI_VALIDATION` | `true` | Metrics label |
| `PROCESSING_MODE` | `sync` | Metrics label |

---

## Authentication & Authorization

### 1. API Authentication (Required for all /agent/* routes)

```http
Authorization: Bearer <API_KEY>
```

### 2. Dual Authentication (Required for sensitive operations)

Sensitive methods require an additional Authorization Credential:

```http
Authorization: Bearer <API_KEY>
x-authorization: Bearer <authorizationCredentialJWT>
```

**Sensitive methods** include: `didManagerAddKey`, `didManagerDelete`, credential save operations, and others defined in `VERAMO_DUAL_AUTH_METHODS`.

### Getting Authorization Credentials

**One-shot method** (creates DID + issues authorization VC):

```bash
curl -X POST http://localhost:3332/agent/didManagerCreateWithAccessRights \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "args": {
      "alias": "my-user",
      "provider": "did:key",
      "kms": "local",
      "permissions": ["didManagerAddKey", "dataStoreSaveVerifiableCredential"],
      "ttlMs": 86400000
    }
  }'
```

**Response includes:**
- `didIdentifier`: Your new DID
- `authorizationCredential`: The verifiable credential
- `authorizationCredentialJWT`: JWT handle for dual-auth header

**Using protected methods:**

```bash
curl -X POST http://localhost:3332/agent/didManagerAddKey \
  -H "Authorization: Bearer $API_KEY" \
  -H "x-authorization: Bearer <authorizationCredentialJWT>" \
  -H "Content-Type: application/json" \
  -d '{"args":{"did":"did:key:z6Mk...","key":{"type":"Ed25519","kms":"local"}}}'
```

---

## API Endpoints

### Core Routes

- `GET /health` — Service health check
- `GET /metrics` — Prometheus metrics
- `GET /open-api.json` — OpenAPI specification
- `GET /api-docs` — Swagger UI interface
- `GET /agent-explore` — Interactive agent explorer
- `POST /messaging/*` — DIDComm messaging
- `POST /agent/*` — Veramo Remote Server methods

### Key Methods

**DID Management:**
- `didManagerGetOrCreate` — Get existing or create new DID
- `didManagerCreateWithAccessRights` — Create DID with authorization VC
- `didManagerAddKey` — Add key to existing DID
- `didManagerDelete` — Remove DID

**Credential Operations:**
- `createVerifiableCredential` — Issue new VC
- `verifyCredential` — Verify VC validity
- `dataStoreSaveVerifiableCredential` — Store VC in database

**Authorization:**
- `createVCForDIDGrant` — Issue authorization VC for existing DID
- `verifyDidGrant` — Verify authorization permissions

---

## DID Resolution & Caching

**Supported Methods:**
- `did:key`, `did:jwk`, `did:peer`, `did:web`, `did:pkh`
- `did:ethr:*` (via Infura)
- Universal resolver fallback for `did:elem`, `did:ion`, `did:sov`, etc.

**Caching Behavior:**
- LRU cache with 10-minute TTL
- Configurable via `CACHE_DID` environment variable
- `did:ethr` always uses cache heuristics
- Cache skip option for selected method when `CACHE_DID=false`

---

## Observability

### Prometheus Metrics

**HTTP Metrics:**
- `http_requests_total` — Request count by method/status
- `http_request_duration_seconds` — Request latency
- `http_request_size_bytes` / `http_response_size_bytes` — Payload sizes

**Authentication Metrics:**
- `authentication_attempts_total` — API key validation attempts
- `authorization_checks_total` — Permission verification count
- `dual_auth_checks_total` — Dual-auth validation attempts
- `authorization_duration_seconds` — Auth processing time

**DID Operations:**
- `did_operations_total` — DID operation count by type/method
- `did_operation_duration_seconds` — DID operation latency
- `did_resolution_duration_seconds` — Resolution timing
- `did_cache_hits_total` / `did_cache_misses_total` — Cache performance

**Credential Operations:**
- `credential_operations_total` — VC operation count
- `credential_operation_duration_seconds` — VC operation timing
- `credential_verifications_total` — Verification attempts
- `credential_verification_duration_seconds` — Verification timing

---

## Development

### Local Setup

```bash
# Install dependencies
yarn install

# Type checking
yarn check

# Development (hot reload)
yarn dev

# Production start
yarn start
```

### Architecture Notes

- **TypeScript-first** codebase running via `tsx`
- **TypeORM** for database abstraction
- **LRU cache** for DID resolution performance
- **Prometheus** metrics integration
- **Dual-auth** middleware for sensitive operations

---

## Security Considerations

- **Protect secrets**: Keep `API_KEY` and `SECRET_KEY` secure
- **Network security**: Guard `/metrics` endpoint in production
- **Database security**: Use hardened `DATABASE_URL` for production
- **Authorization model**: Dual-auth ensures method-level permissions even with API access

---
