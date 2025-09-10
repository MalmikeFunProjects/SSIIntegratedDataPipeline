# Grafana for Veramo Agent Metrics

This guide shows how to set up Grafana with Prometheus to visualize Veramo Agent and Kafka Consumer metrics using a pre-configured dashboard.

## Prerequisites

- Docker & Docker Compose
- A running Prometheus container accessible at `http://prometheus:9090` on the same Docker network (e.g., `veramo_network`)
- Veramo Agent exposing `/metrics` endpoint that Prometheus scrapes

## Setup

### 1. Create Directory Structure

Set up the following folder structure in your project:

```
grafana/
  provisioning/
    datasources/
      prometheus.yml
  dashboard_configurations/
    grafana_dashboard.json  # your dashboard JSON
```

### 2. Configure Prometheus Data Source

Create `grafana/provisioning/datasources/datasource.yml`:

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

### 3. Configure Dashboard Auto-Loading (Optional)

To automatically load dashboards on startup, create `grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1

providers:
  - name: 'Thesis Dashboards'
    orgId: 1
    folder: 'Thesis'
    type: file
    disableDeletion: false
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards
```

Place your dashboard JSON file as `grafana/provisioning/dashboards/thesis-dashboard.json`.

### 4. Add Grafana to Docker Compose

Add this service to your `docker-compose.yml`:

```yaml
services:
  grafana:
    image: grafana/grafana
    container_name: grafana
    hostname: grafana
    ports:
      - "3000:3000"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SECURITY_ALLOW_EMBEDDING=true
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
    networks:
      - veramo_network

volumes:
  grafana-data:
```

### 5. Start Grafana

```bash
docker compose up -d grafana
```

### 6. Access Grafana

Open [http://localhost:3000](http://localhost:3000)

- Username: `admin`
- Password: `admin`

**Security Note:** Change the admin password and disable anonymous auth in production.

## Dashboard Import (Alternative to Auto-Loading)

If you didn't configure automatic dashboard loading:

### Via Web UI
1. Navigate to **Dashboards → Import**
2. Paste your dashboard JSON
3. Select **Prometheus** as the data source
4. Click **Import**

### Via API
```bash
curl -u admin:admin \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/dashboards/db \
  -d @grafana/provisioning/dashboards/thesis-dashboard.json
```

## Dashboard Metrics

The sample dashboard includes panels for:

- **End-to-end latency (p95)**
- **DID provider-specific latencies** (did:key, did:web, did:ethr)
- **Credential verification latency**
- **Throughput** (events/sec)
- **DID resolution latency**
- **Payload size heatmaps**
- **CPU usage** (requires cAdvisor)

Example queries used:
```promql
# End-to-end latency p95
histogram_quantile(0.95, sum by(le) (rate(kafka_consumer_message_end_to_end_latency_seconds_bucket[30s])))

# Throughput
sum(rate(kafka_consumer_message_end_to_end_latency_seconds_count[30s]))
```

## Production Considerations

- **Security**: Set a strong admin password and disable anonymous access:
  ```yaml
  - GF_AUTH_ANONYMOUS_ENABLED=false
  ```
- **TLS**: Deploy behind a reverse proxy with TLS termination
- **Persistence**: Dashboard files in `grafana/provisioning/dashboards/` serve as source of truth
- **Access Control**: Restrict API endpoints if exposing publicly

## Troubleshooting

**No data in panels:**
- Verify Prometheus targets are UP and scraping
- Check data source configuration points to `http://prometheus:9090`
- Adjust dashboard time range

**Dashboard not loading:**
- Check container logs: `docker logs grafana`
- Validate YAML syntax and file paths
- Ensure proper Docker network connectivity

**Metric name mismatches:**
- Edit panel queries to match your actual metric names
- Verify your services emit expected labels (`did_provider`, `ssi_validation`, etc.)

