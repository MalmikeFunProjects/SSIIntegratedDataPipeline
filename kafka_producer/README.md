# Kafka Producer

A lightweight Python service that consumes WebSocket streams, performs payload normalization for Verifiable Credentials, and publishes Avro-encoded events to Kafka using Confluent's Schema Registry.

## Features

* **Multi-WebSocket fan-in**: Connect to multiple WebSocket URLs concurrently
* **VC normalization**: Fixes `@context` → `context` in Verifiable Credentials to match Avro schemas
* **Avro + Schema Registry**: Uses latest registered schema versions (schemas must be pre-registered)
* **Prometheus metrics**: Producer and WebSocket activity monitoring on port 9000
* **Docker ready**: Runs under Docker Compose with Poetry-managed dependencies

## Data Flow

```
WebSocket(s) → JSON parse + normalization → Kafka (Avro-encoded)
```

The service resolves schemas as `{schema.name}-value` subjects and publishes to topics named after the schema.

## Project Structure

```
kafka_producer/
├─ app/
│  ├─ main.py                         # Entry point
│  ├─ gather_data/
│  │  ├─ process_data.py              # WS → normalization → Kafka orchestration
│  │  └─ websocket_data_request.py    # WebSocket client
│  ├─ handlers/kafka_producer.py      # Confluent producer + Avro serializer
│  ├─ metrics/metrics.py              # Prometheus metrics
│  ├─ utils/settings.py               # Environment configuration
│  └─ utils/utilities.py              # Utilities and callbacks
├─ scripts/entryPoint.sh              # Startup script
├─ Dockerfile
├─ pyproject.toml                     # Poetry dependencies
└─ sample.env                         # Configuration template
```

## Configuration

### Required Environment Variables

#### Kafka Infrastructure
```env
BOOTSTRAP_SERVERS="kafka:29092"
SCHEMA_REGISTRY_URL="http://schema-registry:8081"
```

#### Data Sources (at least one required)
```env
# Finnhub trading data
KAFKA_TOPIC_FINNHUB_TRADE="TradeEvent"           # Topic and schema name
FINNHUB_DATA_URLS="ws://data_synthesizer:4200/ws"
FINNHUB_TRADE_DATA="True"                        # Enable stream

# IoT sensor data
KAFKA_TOPIC_HEALTH_SENSOR="health_sensor"        # Topic and schema name
IOT_SYNTHETIC_URLS="ws://synthesizer1:3339/ws,ws://synthesizer2:3339/ws"
IOT_SYNTHETIC_DATA="False"                       # Enable stream
```

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_FINNHUB_TRADE_KEY_NAME` | `FinnhubTrade` | Kafka record key for Finnhub |
| `KAFKA_HEALTH_SENSOR_KEY_NAME` | `HealthSensor` | Kafka record key for IoT |
| `DID_PROVIDER` | `did:key` | Metrics label |
| `SSI_VALIDATION` | `true` | Metrics label |
| `CACHE_DID` | `false` | Metrics label (auto-true for `did:ethr`) |
| `PROCESSING_MODE` | `sync` | Metrics label |
| `PRODUCER_TIMEOUT` | *(none)* | WebSocket timeout in seconds |

## Setup and Deployment

### Prerequisites

1. **Register schemas** using your `kafka_initialiser` service before starting the producer
2. Ensure Kafka and Schema Registry are running
3. Ensure WebSocket data sources are available

### Docker Compose (Recommended)

```yaml
kafka_producer:
  container_name: kafka_producer
  build:
    context: ./kafka_producer
    dockerfile: Dockerfile
  ports:
    - "9000:9000"    # Prometheus metrics
  networks:
    - veramo_network
  environment:
    DID_PROVIDER: ${DID_PROVIDER:-did:key}
    SSI_VALIDATION: ${SSI_VALIDATION:-true}
    CACHE_DID: ${CACHE_DID:-false}
    PROCESSING_MODE: ${PROCESSING_MODE:-sync}
  depends_on:
    kafka_initialiser:
      condition: service_healthy
    data_synthesizer:
      condition: service_healthy
```

Start the service:
```bash
docker compose up -d --build kafka_producer
```

### Standalone Docker

```bash
docker build -t kafka-producer ./kafka_producer

docker run --rm --name kafka_producer \
  -e SCHEMA_REGISTRY_URL=http://schema-registry:8081 \
  -e BOOTSTRAP_SERVERS=kafka:29092 \
  -e FINNHUB_TRADE_DATA=True \
  -e FINNHUB_DATA_URLS=ws://data_synthesizer:4200/ws \
  -e KAFKA_TOPIC_FINNHUB_TRADE=TradeEvent \
  -p 9000:9000 \
  --network veramo_network \
  kafka-producer
```

## Data Processing

The producer applies minimal transformations to incoming WebSocket messages:

**Verifiable Credential normalization**: If a message contains `tradeCredential` with `@context`, it's renamed to `context`:

```json
// Before normalization
{
  "tradeCredential": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    // ... rest of VC
  }
}

// After normalization
{
  "tradeCredential": {
    "context": ["https://www.w3.org/2018/credentials/v1"],
    // ... rest of VC
  }
}
```

All other data passes through unchanged before Avro serialization.

## Monitoring

### Metrics Endpoint

Access Prometheus metrics at: `http://localhost:9000`

### Available Metrics

All metrics include common labels: `did_provider`, `ssi_validation`, `cache_did`, `processing_mode`

**Producer Metrics:**
- `kafka_producer_requests_total{topic, ...}`
- `kafka_producer_request_failures_total{topic, ...}`
- `kafka_producer_request_duration_seconds{topic, ...}`

**WebSocket Metrics:**
- `kafka_producer_websocket_connections_total{url, ...}`
- `kafka_producer_websocket_disconnections_total{url, ...}`
- `kafka_producer_websocket_connection_errors_total{url, ...}`
- `kafka_producer_websocket_messages_received_total{url, ...}`
- `kafka_producer_websocket_connection_duration_seconds{url, ...}`
- `kafka_producer_websocket_messages_timeout_total{...}`

## Troubleshooting

### Common Issues

**Schema Registry Errors**
- *Error*: `Error retrieving schema from registry`
- *Solution*: Ensure `{schema.name}-value` subject exists. Run `kafka_initialiser` first.

**JSON Parsing Errors**
- *Error*: `JSONDecodeError` in logs
- *Solution*: Check WebSocket source data format and connection stability

**Producer Failures**
- *Error*: High `request_failures_total` metrics
- *Solution*: Verify Kafka broker connectivity, topic existence, and Schema Registry access

**No Metrics Available**
- *Error*: Metrics endpoint unreachable
- *Solution*: Confirm port mapping `-p 9000:9000` and check firewall settings

### Configuration Validation

The service validates configuration on startup and will exit with clear error messages for:
- Missing required environment variables
- Unreachable Kafka/Schema Registry endpoints
- Invalid WebSocket URLs
