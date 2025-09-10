# Prometheus for Veramo Stack

This README explains how to run **Prometheus** to scrape metrics from your Veramo services, Kafka, and host system, using a template-driven config and Docker Compose.

## Overview

This setup provides:
- **Templated Prometheus config** rendered at runtime via `envsubst`
- Metrics collection from Veramo services, Kafka, and system resources
- Dynamic runtime labels for experiment tracking
- Health monitoring and persistent storage

### Monitored Services

| Service | Port | Description |
|---------|------|-------------|
| `data_synthesizer` | 2122 | Data synthesis metrics |
| `kafka_producer` | 9000 | Kafka producer metrics |
| `kafka_consumer` | 9001 | Kafka consumer metrics |
| `veramo_server` | 3332 | Veramo server metrics |
| `credential_verifier` | 4321 | Credential verification metrics |
| `node-exporter` | 9100 | Host-level system metrics |
| `cadvisor` | 8080 | Container metrics |
| `kafka-exporter` | 9308 | Kafka broker & consumer lag metrics |

## Setup

### 1. Folder Structure

```
prometheus/
  prometheus.yml.template   # Template for Prometheus configuration
```

### 2. Configuration Template

The `prometheus/prometheus.yml.template` file defines scrape jobs with environment variable substitution:

```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: 'data_synthesizer'
    static_configs:
      - targets: ['data_synthesizer:2122']

  - job_name: 'kafka_producer'
    static_configs:
      - targets: ['kafka_producer:9000']

  - job_name: 'kafka_consumer'
    static_configs:
      - targets: ['kafka_consumer:9001']

  - job_name: 'veramo_server'
    static_configs:
      - targets: ['veramo_server:3332']

  - job_name: 'credential_verifier'
    static_configs:
      - targets: ['credential_verifier:4321']

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']

  - job_name: 'kafka-exporter'
    static_configs:
      - targets: ['kafka-exporter:9308']
        labels:
          did_provider: ${DID_PROVIDER}
          ssi_validation: ${SSI_VALIDATION}
          cache_did: ${CACHE_DID}
          processing_mode: ${PROCESSING_MODE}
```

### 3. Docker Compose Configuration

Add these services to your `docker-compose.yml`:

```yaml
# Config builder - renders prometheus.yml from template
prometheus-config:
  image: alpine:latest
  hostname: prometheus-config
  container_name: prometheus-config
  volumes:
    - ./prometheus/prometheus.yml.template:/tmp/prometheus.yml.template
    - prometheus-config:/prometheus-config
  environment:
    DID_PROVIDER: ${DID_PROVIDER:-did:key}
    SSI_VALIDATION: ${SSI_VALIDATION:-true}
    CACHE_DID: ${CACHE_DID:-false}
    PROCESSING_MODE: ${PROCESSING_MODE:-sync}
  command: |
    sh -euo pipefail -c '
      apk add --no-cache gettext
      envsubst < /tmp/prometheus.yml.template > /prometheus-config/prometheus.yml
      if grep -q '$\{' /prometheus-config/prometheus.yml; then
        echo "Unsubstituted variables remain";
        exit 1
      fi
      echo "All items substituted"
    '
  restart: "no"

# Prometheus server
prometheus:
  image: prom/prometheus
  container_name: prometheus
  hostname: prometheus
  depends_on:
    prometheus-config:
      condition: service_completed_successfully
  volumes:
    - prometheus-config:/etc/prometheus
    - prometheus-data:/prometheus
  ports:
    - "9090:9090"
  restart: always
  networks:
    - veramo_network
  healthcheck:
    test: ["CMD-SHELL", "wget --spider -q http://localhost:9090/-/healthy || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 3

# System metrics exporters
node-exporter:
  image: prom/node-exporter
  container_name: node-exporter
  hostname: node-exporter
  ports:
    - "9100:9100"
  restart: always
  networks:
    - veramo_network

cadvisor:
  image: gcr.io/cadvisor/cadvisor:latest
  container_name: cadvisor
  hostname: cadvisor
  ports:
    - "8080:8080"
  volumes:
    - /:/rootfs:ro
    - /var/run:/var/run:ro
    - /sys:/sys:ro
    - /var/lib/docker/:/var/lib/docker:ro
  restart: always
  networks:
    - veramo_network

kafka-exporter:
  image: danielqsj/kafka-exporter:latest
  container_name: kafka-exporter
  hostname: kafka-exporter
  ports:
    - "9308:9308"
  networks:
    - veramo_network
  command:
    - "--kafka.server=kafka:29092"
    - "--kafka.version=7.4.0"
    - "--web.listen-address=:9308"
    - "--web.telemetry-path=/metrics"
  depends_on:
    kafka:
      condition: service_healthy

volumes:
  prometheus-config:
  prometheus-data:
```

## Deployment

### 1. Start the Stack

```bash
# Start Prometheus and exporters
docker compose up -d prometheus-config prometheus node-exporter cadvisor kafka-exporter

# Or start the entire stack
docker compose up -d
```

### 2. Verify Setup

- **Prometheus UI:** [http://localhost:9090](http://localhost:9090)
- **Check targets:** Go to Status → Targets to verify all jobs are **UP**
- **View config:** Go to Status → Configuration to see the rendered configuration

### 3. Configure Environment Variables

To customize runtime labels for experiments:

```bash
export DID_PROVIDER="did:web"
export SSI_VALIDATION="true"
export CACHE_DID="true"
export PROCESSING_MODE="async"
docker compose up -d prometheus-config prometheus
```

## Integration

### Grafana Integration

Use `http://prometheus:9090` as the Prometheus data source URL in Grafana (both must be on the same Docker network).

### Useful Queries

```promql
# Kafka consumer lag
max(kafka_consumer_kafka_consumer_lag)

# End-to-end latency (95th percentile)
histogram_quantile(0.95, sum by(le) (rate(kafka_consumer_message_end_to_end_latency_seconds_bucket[1m])))

# Credential verification duration (95th percentile)
histogram_quantile(0.95, sum by(le) (rate(kafka_consumer_credential_verification_duration_seconds_bucket[1m])))

# CPU usage percentage
rate(container_cpu_usage_seconds_total{id="/"}[1m]) / scalar(machine_cpu_cores) * 100
```

## Customization

### Scrape Configuration
- **Change scrape interval:** Modify `global.scrape_interval` in the template
- **Add retention:** Uncomment the retention command flag in the Prometheus service
- **Hot reload:** Add `--web.enable-lifecycle` flag, then use `curl -X POST http://localhost:9090/-/reload`

### Adding New Services
Add a new job block to the template:

```yaml
- job_name: 'my_service'
  static_configs:
    - targets: ['my_service:1234']
```

## Troubleshooting

### Common Issues

**Target DOWN:**
- Verify service is running and reachable on the Docker network
- Check endpoint path and port configuration
- Review Prometheus logs: `docker logs prometheus`

**Config Sidecar Failure:**
- Ensure all environment variables are set (config fails if any `${VAR}` remains unsubstituted)
- Check rendered config by inspecting the volume

**Missing Metrics:**
- **Kafka:** Verify kafka service is healthy at `kafka:29092`
- **cAdvisor:** Check volume mounts are readable on host OS
- **Node Exporter:** Ensure port 9100 is accessible

### Security Considerations

- Prometheus UI exposed on port 9090 with no authentication - restrict access via firewall or reverse proxy
- Exporters expose read-only metrics - avoid public internet exposure

## Runtime Labels

The following labels are automatically applied to `kafka-exporter` metrics based on environment variables:

| Label | Environment Variable | Default |
|-------|---------------------|---------|
| `did_provider` | `DID_PROVIDER` | `did:key` |
| `ssi_validation` | `SSI_VALIDATION` | `true` |
| `cache_did` | `CACHE_DID` | `false` |
| `processing_mode` | `PROCESSING_MODE` | `sync` |

These labels enable filtering and comparison of experiment results in Grafana dashboards.
