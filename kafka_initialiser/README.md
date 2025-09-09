# Kafka Initialiser

Bootstraps your Kafka stack by **validating & registering Avro schemas** in Confluent Schema Registry (with **references & dependency order**) and **creating Kafka topics**. Ships as a container that runs once, writes a health flag, and then idles (useful for Compose-based stacks that need "setup done" semantics).

## What it does

1. **Loads Avro schemas** from a directory and validates their structure + semantics
2. **Builds a dependency graph** and computes **topological order** so referenced records are registered first
3. **Registers schemas** in Schema Registry with proper **references**
4. **Creates Kafka topics** listed in your environment

It's idempotent: topics are only created if missing, and schema registration handles versions via Schema Registry.

## Project Structure

```
kafka_initialiser/
├─ app/
│  ├─ main.py                         # Entrypoint
│  ├─ kafka_schema_manager.py         # Orchestrates load → register → topics
│  ├─ schema_loader.py                # Loads .avsc, builds dependencies
│  ├─ avro_schema_validator.py        # Structural/semantic validation
│  ├─ schema_registry_manager.py      # Confluent SR client
│  ├─ kafka_topic_manager.py          # Creates topics via AdminClient
│  ├─ constants.py                    # Types + data classes
│  └─ utilities.py                    # Helpers (e.g., FQN builder)
├─ resources/avro/
│  └─ trade_event.avsc                # Example Avro record (TradeEvent)
├─ scripts/
│  └─ entryPoint.sh                   # Copies sample.env → .env, runs setup
├─ Dockerfile
├─ pyproject.toml                     # Poetry configuration
└─ sample.env                         # Default environment variables
```

## Requirements

- **Kafka** (brokers reachable via `BOOTSTRAP_SERVERS`)
- **Confluent Schema Registry** (reachable via `SCHEMA_REGISTRY_URL`)

## Configuration

### Environment Variables

| Variable                   | Required | Default              | Description                                                                          |
| -------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------ |
| `AVRO_SCHEMA_PATH`         | No       | `app/resources/avro` | Directory containing `.avsc` files                                                   |
| `EVENT_TOPICS`             | Yes      | —                    | Comma-separated list of Kafka topics to create, e.g. `TradeEvent,HealthSensorRecord` |
| `SCHEMA_REGISTRY_URL`      | Yes      | —                    | e.g. `http://schema-registry:8081`                                                   |
| `BOOTSTRAP_SERVERS`        | Yes      | —                    | e.g. `kafka:29092`                                                                   |
| `KAFKA_PARTITIONS`         | Yes      | —                    | Partitions per topic (int)                                                           |
| `KAFKA_REPLICATION_FACTOR` | Yes      | —                    | Replication factor per topic (int)                                                   |

### Default Configuration (sample.env)

The entrypoint script copies `sample.env` → `.env` inside the container with these defaults:

```env
AVRO_SCHEMA_PATH="app/resources/avro"
EVENT_TOPICS="TradeEvent,HealthSensorRecord,SignedTradeEvent,TradeEventRef"
SCHEMA_REGISTRY_URL="http://schema-registry:8081"
BOOTSTRAP_SERVERS="kafka:29092"
KAFKA_PARTITIONS=1
KAFKA_REPLICATION_FACTOR=1
```

Runtime variables override the baked `.env` file.

## Usage

### Docker Compose (Recommended)

```bash
docker compose up -d --build kafka_initialiser
docker compose logs -f kafka_initialiser
```

### Local Development

```bash
# In the kafka_initialiser directory
python -m venv .venv && source .venv/bin/activate
pip install poetry
poetry install

# Set environment variables
export AVRO_SCHEMA_PATH="app/resources/avro"
export EVENT_TOPICS="TradeEvent,HealthSensorRecord"
export SCHEMA_REGISTRY_URL="http://localhost:8081"
export BOOTSTRAP_SERVERS="localhost:9092"
export KAFKA_PARTITIONS=1
export KAFKA_REPLICATION_FACTOR=1

poetry run python -m app.main
```

## Example Schema

The included `resources/avro/trade_event.avsc` defines a `io.malmike.trades.TradeEvent` record that can carry either raw trade data or a Verifiable Credential:

- Top-level fields: `start_timestamp`, `symbol`, `trade_event_id`
- `tradeData`: optional nested record `RawTradeData`
- `tradeCredential`: optional nested record `TradeCredential` (with `@context` alias to `context`, issuer, credentialSubject.claims.TradeData, proof, etc.)

This serves as a template for events that may be signed (SSI) or unsigned.

## How It Works

- **Schema Validation**: Checks structure, validates record fields, unions, arrays, maps
- **Dependency Resolution**: Builds FQNs (`namespace.name`) and dependency graph, uses Kahn's algorithm for registration order
- **Schema Registration**: Registers as AVRO with references to dependencies, uses `<name>-value` subject naming (e.g., `TradeEvent-value`)
- **Topic Creation**: Checks existence and creates missing topics with specified partitions & replication
- **Health Check**: Writes `SUCCESS` to `/tmp/healthcheck.log` on completion, then tails forever

## Troubleshooting

**"No .avsc files found"**
- Ensure `AVRO_SCHEMA_PATH` points to the correct directory containing schemas

**Schema cycles detected**
- Break circular dependencies by factoring shared records

**Schema registry errors (HTTP 4xx/5xx)**
- Verify `SCHEMA_REGISTRY_URL` reachability
- For authenticated registries, extend `SchemaRegistryClient` config

**Topic creation fails**
- Check `BOOTSTRAP_SERVERS` and broker health
- Verify broker ACLs (container needs `Create` permission)

**Healthcheck stays unhealthy**
- Check logs: `docker compose logs -f kafka_initialiser`
- `SUCCESS` is only written when `python -m app.main` exits with code `0`

**Environment variable issues**
- `main.py` reads `AVRO_SCHEMA_PATH`, not `AVRO_SCHEMA_DIR`
- Avoid spaces in `EVENT_TOPICS` comma-separated values

## Extending

- Add more `.avsc` files to your schema directory - they'll be picked up automatically
- Keep Fully Qualified Name(FQNs) consistent across namespaces for cross-references

    > In the context of this Kafka Initialiser and Avro schemas, an FQN is the complete name of an Avro record that includes both its namespace and name, formatted as `namespace.name`.
    > For example:

    > If you have an Avro schema with:
    ```json
    {
        "type": "record",
        "namespace": "io.malmike.trades",
        "name": "TradeEvent",
        ...
    }
    ```

    > The FQN would be: io.malmike.trades.TradeEvent
- For validation-only mode, call `KafkaSchemaManager.validate_schemas_only()` (not wired by default)

## Notes

- **Schema subjects** default to `<name>-value` format
- **Topics** are independent of subject names - control them via `EVENT_TOPICS`
- Common convention is to align topic names with event record names, but this isn't enforced
