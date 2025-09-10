# SSI Integrated Data Pipeline

A complete, containerised pipeline that generates market-like data, signs it with SSI (Verifiable Credentials), streams it through Kafka, verifies it, and exposes rich observability via Prometheus & Grafana.

## Prerequisites

* Docker & Docker Compose v2
* (Optional) `curl` for health checks
* (Optional) **INFURA_PROJECT_ID** for `did:ethr:*` scenarios


## Architecture & Data Flow

1. **Data Synthesizer** streams trade events over WebSocket, requesting Verifiable Credentials from **Veramo Agent**
2. **Kafka Producer** consumes WebSocket events and produces Avro messages to **Kafka**
3. **Kafka Consumer** consumes from Kafka and verifies credentials via **Veramo Verifier**
4. All components expose **Prometheus metrics** for observability in **Grafana**

## System Components

```
.
├── data_synthesizer/        # Streams "trades" over WS; requests VC signing
├── kafka_producer/          # Reads WS data → produces Avro messages to Kafka
├── kafka_consumer/          # Consumes Kafka → verifies credentials
├── kafka_initialiser/       # Creates topics & registers Avro schemas
├── veramo-agent/            # SSI Issuer API (DID mgmt, credential issuance)
├── veramo-verifier/         # SSI Verifier API (credential verification)
├── host_did_web/            # Helper to host did:web documents
├── prometheus/              # Templated Prometheus config
├── grafana/                 # Provisioned datasource + dashboard
└── docker-compose.yml       # All services orchestration
```

## Key Ports

| Service | Port | Purpose |
|---------|------|---------|
| Grafana | **3000** | Dashboard UI |
| Prometheus | **9090** | Metrics scraper UI |
| Kafka Control Center | **9021** | Kafka management UI |
| Data Synthesizer | **4200** | API endpoint |
| Veramo Agent | **3332** | SSI Issuer API |
| Veramo Verifier | **4321** | SSI Verifier API |
| Kafka | **9092** | Broker (host access) |
| Schema Registry | **8081** | Avro schemas |
| Postgres | **5432** | Veramo persistence |
| pgAdmin | **8088** | Database UI |

## Component Documentation

Each service has detailed documentation in its subdirectory:

* [veramo-agent/README.md](veramo-agent/README.md) - DID management, VC issuance, metrics
* [veramo-verifier/README.md](veramo-verifier/README.md) - Verification API, DID resolvers, caching
* [data_synthesizer/README.md](data_synthesizer/README.md) - Trade data generation, WebSocket streaming
* [kafka_producer/README.md](kafka_producer/README.md) - Kafka message production
* [kafka_consumer/README.md](kafka_consumer/README.md) - Kafka consumption and verification
* [kafka_initialiser/README.md](kafka_initialiser/README.md) - Topic and schema management
* [host_did_web/README.md](host_did_web/README.md) - DID document hosting
* [grafana/README.md](grafana/README.md) - Dashboard provisioning
* [prometheus/README.md](prometheus/README.md) - Metrics configuration



## Quick Start

1. **Clone and configure**
   ```bash
   cp sample.env .env
   # Edit .env with one of the configuration options below
   ```

2. **Start the pipeline**
   ```bash
   docker compose up -d --build
   ```

3. **Verify services are healthy**
   ```bash
   curl -s localhost:3332/health    # Veramo Agent
   curl -s localhost:4321/health    # Veramo Verifier
   curl -s localhost:4200/health    # Data Synthesizer
   curl -s localhost:3338/health    # Kafka Consumer
   ```

4. **Access the dashboards**
   * Grafana: [http://localhost:3000](http://localhost:3000)
   * Prometheus: [http://localhost:9090](http://localhost:9090)
   * Kafka Control Center: [http://localhost:9021](http://localhost:9021)

## Configuration Options

Choose **one** of these configurations and paste into your `.env` file:

**Option 1: did:web, async, no DID cache**
```
DID_PROVIDER=did:web
SSI_VALIDATION=true
CACHE_DID=false
PROCESSING_MODE=async
PRODUCER_TIMEOUT=300.0
```

**Option 2: did:web, sync, cached DID**
```
DID_PROVIDER=did:web
SSI_VALIDATION=true
CACHE_DID=true
PROCESSING_MODE=sync
PRODUCER_TIMEOUT=300.0
```

**Option 3: did:key, sync, no DID cache**
```
DID_PROVIDER=did:key
SSI_VALIDATION=true
CACHE_DID=false
PROCESSING_MODE=sync
PRODUCER_TIMEOUT=300.0
```

**Option 4: did:key, sync, cached DID**
```
DID_PROVIDER=did:key
SSI_VALIDATION=true
CACHE_DID=true
PROCESSING_MODE=sync
PRODUCER_TIMEOUT=300.0
```

**Option 5: validation disabled**
```
SSI_VALIDATION=false
PRODUCER_TIMEOUT=300.0
```

**Option 6: did:ethr:sepolia, sync, cached DID**
```
DID_PROVIDER=did:ethr:sepolia
SSI_VALIDATION=true
CACHE_DID=true
PROCESSING_MODE=sync
PRODUCER_TIMEOUT=300.0
```
## Verifying the Pipeline

1. **Check data flow** in Grafana:
   * Throughput panels showing increasing messages/sec
   * End-to-end latency grouped by `did_provider`
   * Consumer lag near zero

2. **Verify credential operations**:
   * Issuer metrics: `http://localhost:3332/metrics`
   * Verifier metrics: `http://localhost:4321/metrics`

3. **Confirm Kafka activity**:
   * Control Center showing message counts
   * Schema Registry at `http://localhost:8081/subjects`

## Common Operations

**Change configuration:**
```bash
# Edit .env with new option
docker compose down
docker compose up -d --build
```

**Reset all data:**
```bash
docker compose down -v
docker compose up -d --build
```

**View service logs:**
```bash
docker compose logs -f kafka_consumer
```

## Troubleshooting

**Prometheus won't start:** Ensure `.env` contains a complete configuration option with all required variables.

**`did:ethr` resolution fails:** Add `INFURA_PROJECT_ID` to Verifier/Agent environments (see individual READMEs).

**Empty Grafana panels:** Wait 30-60 seconds for metrics generation; verify `/metrics` endpoints are accessible.

**High consumer lag:** Check `kafka_consumer` logs and Verifier metrics. Enable DID cache (`CACHE_DID=true`) to reduce latency.

