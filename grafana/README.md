# Grafana for Veramo Agent Metrics

This repository provides a ready-to-use Grafana setup for visualizing **Veramo Agent** and **Kafka Consumer** metrics, along with a Python utility to export dashboard panels as PNG images for reporting or thesis work.

---

## 📂 Project Structure

```
.
├── export_graphs_as_png/        # Python project for PNG export
│   ├── export_graphs_as_png/
│   │   └── download_panels.py   # Export logic
│   ├── poetry.lock
│   ├── pyproject.toml           # Poetry project definition
│   └── sample.env               # Example environment variables
├── provisioning/                # Grafana provisioning config
│   ├── dashboards/
│   │   └── thesis_dashboard.json # Pre-configured dashboard
│   └── datasources/
│       └── datasource.yml       # Prometheus data source
└── README.md
```

---

## 🚀 Prerequisites

* Docker & Docker Compose
* Prometheus container running on the same Docker network (`veramo_network`), scraping:

  * Veramo Agent `/metrics`
  * Kafka Consumer `/metrics`
* Python 3.12+ (for the PNG export tool)
* [Poetry](https://python-poetry.org/) for dependency management

---

## ⚙️ Grafana Setup

### 1. Configure Prometheus Data Source

`provisioning/datasources/datasource.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

### 2. Provision Dashboard

`provisioning/dashboards/thesis_dashboard.json` contains a ready-made dashboard.
It is automatically loaded at startup.

### 3. Docker Compose Service

```yaml
services:
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    volumes:
      - ./provisioning:/etc/grafana/provisioning
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_SECURITY_ALLOW_EMBEDDING=true
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer
      # external image renderer
      - GF_RENDERING_SERVER_URL=http://grafana_renderer:8081/render
      - GF_RENDERING_CALLBACK_URL=http://grafana:3000/
      - GF_SERVER_ROOT_URL=http://grafana:3000/
    depends_on:
      - grafana_renderer
    networks: [veramo_network]

  grafana_renderer:
    image: grafana/grafana-image-renderer:latest
    container_name: grafana_renderer
    ports:
      - "3001:8081"   # host:container mapping (Grafana talks to 8081 internally)
    environment:
      - ENABLE_METRICS=true
    shm_size: "256m"   # recommended for Chromium stability
    security_opt:
      - seccomp:unconfined
    networks: [veramo_network]

volumes:
  grafana-data:
```

### 4. Start Grafana

```bash
docker compose up -d grafana grafana_renderer
```

Visit [http://localhost:3000](http://localhost:3000)
Default credentials: `admin` / `admin` (change immediately).

---

## 📊 Metrics in the Dashboard

The dashboard visualizes:

* End-to-end latency (p95)
* DID provider latencies (did\:key, did\:web, did\:ethr)
* Credential verification latency
* Throughput (events/sec)
* DID resolution latency
* Payload size distribution
* CPU usage (via cAdvisor)

Example queries:

```promql
# End-to-end latency p95
histogram_quantile(0.95, sum by(le) (rate(kafka_consumer_message_end_to_end_latency_seconds_bucket[30s])))

# Throughput
sum(rate(kafka_consumer_message_end_to_end_latency_seconds_count[30s]))
```

---

## 🖼 Exporting Dashboard Panels as PNGs

> ⚠️ The API token must be a [Grafana service account token](https://grafana.com/docs/grafana/latest/administration/service-accounts/). Treat it like a password.


### OPTION 1: One-off PNG export (single panel)

Use the d-solo render endpoint with your dashboard UID and numeric panel ID:

```sh
curl -H "Authorization: Bearer <GRAFANA_TOKEN>" \
  -o panel-1.png \
  "http://localhost:3000/render/d-solo/<DASH_UID>/<SLUG>?orgId=1&panelId=1&from=2025-09-19T15:27:55.000Z&to=2025-09-19T15:33:45.000Z&width=1600&height=900&tz=Europe%2FWarsaw&theme=dark"
```

The `export_graphs_as_png` subproject contains a Poetry-based CLI to export each Grafana panel as a PNG.

### OPTION 2: Export all panels via script
#### 1. Configure environment

Copy and edit the sample environment file:

```bash
cp export_graphs_as_png/sample.env .env
```

Fill in values such as:

```env
GRAFANA_URL=http://localhost:3000
GRAFANA_TOKEN=glsa_<your_token_here>
GRAFANA_DASH_UID=a0424acf-0aa6-4258-b77f-1b05db56cc44
GRAFANA_FROM=2025-09-19T15:27:55.000Z
GRAFANA_TO=2025-09-19T15:33:45.000Z
GRAFANA_WIDTH=1600
GRAFANA_HEIGHT=900
GRAFANA_TZ=Europe/Warsaw
GRAFANA_THEME=dark
GRAFANA_OUTDIR=grafana_panels
```

#### 2. Install dependencies

```bash
cd export_graphs_as_png
poetry install
```

#### 3. Run exporter

```bash
poetry run export-grafana-panels
```

PNGs will be saved in the directory defined by `GRAFANA_OUTDIR` (default: `grafana_panels/`).

---

## 🔐 Production Notes

* Change the admin password and disable anonymous auth (`GF_AUTH_ANONYMOUS_ENABLED=false`)
* Run Grafana behind TLS (reverse proxy, ingress, etc.)
* Don’t commit `.env` files or API tokens to version control
* Pin versions of Grafana and image renderer for reproducibility

