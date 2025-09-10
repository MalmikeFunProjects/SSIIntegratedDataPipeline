# Kafka Consumer

A Python service that consumes Avro-encoded events from Kafka, optionally verifies Verifiable Credentials (VCs) against a Veramo verifier, and exposes Prometheus metrics with health monitoring.

## Overview

**Input:** Kafka topics (Avro via Confluent Schema Registry)
**Processing:** Optional VC verification via Veramo verifier
**Output:** Structured logs + Prometheus metrics
**Monitoring:** Health endpoint on port 3338, metrics on port 9001

## Architecture

```
Kafka (TradeEvent, Avro) ──► KafkaConsumer (DeserializingConsumer + AvroDeserializer)
                                    │
                                    ▼
                        KafkaEventHandler
                        - Denormalize VC: 'context' → '@context'
                        - Optional SSI validation via VeramoClient
                        - Async workers (if configured)
                        - Metrics + structured logs
                                    │
                                    ├─ /health   (3338)
                                    └─ /metrics  (9001)
```

**Note:** The consumer denormalizes payloads by converting `context` back to `@context` before verification, reversing the normalization done by producers for Avro compatibility.

## Project Structure

```
kafka_consumer/
├─ app/
│  ├─ main.py                        # Entry point
│  ├─ handlers/
│  │  ├─ kafka_consumer.py           # Confluent consumer + Avro deserializer
│  │  ├─ kafka_event_handler.py      # Message processing & verification
│  │  └─ veramo_client.py            # HTTP client for credential verifier
│  ├─ metrics/metrics.py             # Prometheus metrics (Singleton)
│  └─ utils/settings.py              # Environment configuration
├─ scripts/entryPoint.sh             # Startup script
├─ Dockerfile
├─ pyproject.toml                    # Dependencies (Poetry)
└─ sample.env                        # Configuration template
```

## Configuration

### Required Environment Variables

| Variable                    | Example                           | Description                     |
| --------------------------- | --------------------------------- | ------------------------------- |
| `SCHEMA_REGISTRY_URL`       | `http://schema-registry:8081`     | Confluent Schema Registry URL   |
| `BOOTSTRAP_SERVERS`         | `kafka:29092`                     | Kafka broker endpoints          |
| `KAFKA_TOPIC_FINNHUB_TRADE` | `TradeEvent`                      | Topic to consume                |
| `VERAMO_API_URL`            | `http://credential_verifier:4321` | Veramo verifier base URL        |
| `VERAMO_API_TOKEN`          | `test123`                         | Bearer token for Veramo API     |

### Optional Configuration

| Variable          | Default   | Description                                                      |
| ----------------- | --------- | ---------------------------------------------------------------- |
| `SSI_VALIDATION`  | `true`    | Enable/disable VC verification via Veramo                       |
| `PROCESSING_MODE` | `sync`    | Processing mode: `sync` or `async`                               |
| `DID_PROVIDER`    | `did:key` | DID provider type (for metrics labeling)                        |
| `CACHE_DID`       | `false`   | DID caching flag (auto-enabled for `did:ethr` providers)        |


### Sample Configuration

```env
SCHEMA_REGISTRY_URL="http://schema-registry:8081"
BOOTSTRAP_SERVERS="kafka:29092"
KAFKA_TOPIC_FINNHUB_TRADE="TradeEvent"
VERAMO_API_TOKEN=test123
VERAMO_API_URL=http://credential_verifier:4321
```

## Deployment

### Docker Compose

```yaml
kafka_consumer:
  container_name: kafka_consumer
  build:
    context: ./kafka_consumer
    dockerfile: Dockerfile
  ports:
    - "3338:3338"   # Health endpoint
    - "9001:9001"   # Metrics endpoint
  environment:
    DID_PROVIDER: ${DID_PROVIDER:-did:key}
    SSI_VALIDATION: ${SSI_VALIDATION:-true}
    PROCESSING_MODE: ${PROCESSING_MODE:-sync}
  healthcheck:
    test: ["CMD-SHELL", "curl -f http://localhost:3338/health || exit 1"]
    interval: 10s
    timeout: 30s
    retries: 5
    start_period: 60s
  depends_on:
    kafka_initialiser:
      condition: service_healthy
    credential_verifier:
      condition: service_healthy
```

**Start the service:**
```bash
docker compose up -d --build kafka_consumer
```

**Check status:**
```bash
curl http://localhost:3338/health    # Health check
curl http://localhost:9001/metrics   # Prometheus metrics
```

### Standalone Docker

```bash
docker build -t kafka-consumer ./kafka_consumer

docker run --rm \
  -e SCHEMA_REGISTRY_URL=http://schema-registry:8081 \
  -e BOOTSTRAP_SERVERS=kafka:29092 \
  -e KAFKA_TOPIC_FINNHUB_TRADE=TradeEvent \
  -e VERAMO_API_URL=http://credential_verifier:4321 \
  -e VERAMO_API_TOKEN=test123 \
  -e SSI_VALIDATION=true \
  -e PROCESSING_MODE=async \
  -p 3338:3338 -p 9001:9001 \
  --network veramo_network \
  kafka-consumer
```

## Processing Modes

### SSI Validation Disabled (`SSI_VALIDATION=false`)
- Fast processing without Veramo verification calls
- Suitable for high-throughput scenarios where verification isn't required

### Synchronous Processing (`SSI_VALIDATION=true` + `PROCESSING_MODE=sync`)
- Sequential message processing with verification
- Simpler debugging and predictable resource usage

### Asynchronous Processing (`SSI_VALIDATION=true` + `PROCESSING_MODE=async`)
- Concurrent processing with bounded workers:
  - 12 worker threads
  - Maximum 25 concurrent verifications (semaphore-controlled)
- Higher throughput for verification-heavy workloads

## Monitoring

### Health Endpoint
- **URL:** `http://localhost:3338/health`
- **Status:** 200 (healthy) after Kafka partition assignment, 503 during startup
- **Purpose:** Container orchestration and readiness checks

### Prometheus Metrics
- **URL:** `http://localhost:9001/metrics`
- **Prefix:** `kafka_consumer_`
- **Labels:** `did_provider`, `ssi_validation`, `cache_did`, `processing_mode`

#### Key Metrics
- **Kafka Consumption:**
  - `kafka_consumer_kafka_messages_consumed_total{topic,status}`
  - `kafka_consumer_kafka_message_processing_duration_seconds{topic}`
  - `kafka_consumer_kafka_messages_per_second{topic}`
  - `kafka_consumer_kafka_consumer_lag{topic}` (seconds since last message)

- **Verification:**
  - `kafka_consumer_veramo_requests_total{endpoint,status_code}`
  - `kafka_consumer_veramo_request_duration_seconds{endpoint}`
  - `kafka_consumer_credential_verification_results_total{result}` (verified/failed/error)

- **End-to-End:**
  - `kafka_consumer_message_end_to_end_latency_seconds` (from message timestamp to processing completion)

## Requirements

### Kafka Topics
- Topics must be registered in Schema Registry (e.g., `TradeEvent-value`)
- Messages must be Avro-encoded
- Producer should normalize VC payloads (`@context` → `context`) for Avro compatibility

### Veramo Integration
- Verifier must expose `POST /agent/verifyCredential` endpoint
- Requires Bearer token authentication
- Consumer handles denormalization before verification calls

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Consumer never becomes healthy | Kafka unreachable or topics missing | Verify Kafka connectivity and topic existence |
| Deserialization errors | Schema mismatch | Ensure producer uses same Avro schema registered in Schema Registry |
| Verification failures (4xx/5xx) | Veramo API issues | Check `VERAMO_API_URL`, `VERAMO_API_TOKEN`, and verifier health |
| High lag/low throughput | Processing bottleneck | Monitor metrics, consider increasing worker counts (code-level change) |

---

