# Data Synthesizer — Finnhub → SSI → WebSocket

A Go service that connects to Finnhub's realtime WebSocket, processes trade ticks into structured events, optionally signs each event as a W3C Verifiable Credential (VC), and broadcasts them to clients over WebSocket with comprehensive Prometheus metrics.

## Features

- **Realtime data ingestion** from Finnhub WebSocket with robust connection handling
- **Per-symbol DID bootstrap** with parallel processing and VC issuance via Veramo
- **WebSocket broadcasting** to multiple clients at `/ws`
- **Configurable message limits** for controlled testing runs
- **Rich Prometheus metrics** for monitoring performance and health
- **Clean shutdown** with graceful context cancellation and goroutine management

## Quick Start

### Docker Compose (Recommended)

1. Set required environment variables in `.env`:
```bash
FINNHUB_API_KEY=your_finnhub_key
TICKERS=BINANCE:BTCUSDT,BINANCE:ETHUSDT
VERAMO_API_URL=http://veramo_server:3332
VERAMO_API_TOKEN=your_veramo_token
# For did:web only:
DID_WEB_HOST=MalmikeFunProjects.github.io
DID_WEB_PROJECT=GenerateDidWeb
```

2. Start the service:
```bash
docker compose up -d --build data_synthesizer
curl -sS http://localhost:4200/health
```

### Plain Docker

```bash
docker build -t data-synthesizer ./data_synthesizer

docker run --name data_synthesizer --rm \
  -p 4200:4200 -p 2122:2122 \
  -e FINNHUB_API_KEY=YOUR_KEY \
  -e TICKERS="BINANCE:BTCUSDT,BINANCE:ETHUSDT" \
  -e VERAMO_API_URL=http://veramo_server:3332 \
  -e VERAMO_API_TOKEN=YOUR_TOKEN \
  data-synthesizer
```

## API Endpoints

- `GET /health` — Health check endpoint
- `GET /metrics` — Prometheus metrics (port 2122 by default)
- `WebSocket /ws` — Realtime trade event stream

### WebSocket Client Example

```js
const ws = new WebSocket('ws://localhost:4200/ws');
ws.onmessage = (ev) => console.log(JSON.parse(ev.data));
ws.onopen = () => console.log('connected');
ws.onclose = () => console.log('closed');
```

## Configuration

| Variable           | Required | Default   | Description |
|--------------------|----------|-----------|-------------|
| `FINNHUB_API_KEY`  | ✅       | —         | Finnhub WebSocket API key |
| `TICKERS`          | ✅       | —         | CSV list (e.g., `BINANCE:BTCUSDT,BINANCE:ETHUSDT`) |
| `VERAMO_API_URL`   | ✅       | —         | Veramo gateway base URL |
| `VERAMO_API_TOKEN` | ✅       | —         | Bearer token for Veramo |
| `PORT`             | ❌       | `4200`    | HTTP/WebSocket port |
| `METRICS_PORT`     | ❌       | `2122`    | Prometheus metrics port |
| `MESSAGE_COUNT`    | ❌       | `1000`    | Max messages before stopping (0 = unlimited) |
| `DID_PROVIDER`     | ❌       | `did:key` | DID method: `did:key` or `did:web` |
| `DID_WEB_HOST`     | ⚠️       | —         | Required for did:web (e.g., `example.com`) |
| `DID_WEB_PROJECT`  | ❌       | —         | Optional project path for did:web |
| `SSI_VALIDATION`   | ❌       | `true`    | Enable VC signing for events |
| `KMS`              | ❌       | `local`   | Key management system for DIDs |
| `CACHE_DID`        | ❌       | `false`   | Metrics label (set to `true` for did:ethr) |
| `PROCESSING_MODE`  | ❌       | `sync`    | Metrics label (`sync`/`async`) |

## Data Flow

```
Finnhub WebSocket → FinnhubClient (subscribe to tickers)
                         ↓ parse & validate
                    TradeProcessor
                         ↓ optional VC signing via Veramo
                    WebSocket Broadcaster → Connected clients
```

## Event Payloads

### Without SSI Validation (`SSI_VALIDATION=false`)

```json
{
  "trade_event_id": "9a7b...e1",
  "symbol": "BINANCE:BTCUSDT",
  "start_timestamp": "2025-09-09T10:10:45.012345Z",
  "tradeData": {
    "Trade_Id": "9a7b...e1",
    "Trade_Condition": [],
    "Price": 60123.45,
    "Symbol": "BINANCE:BTCUSDT",
    "Event_Timestamp": 1694254278000,
    "Volume": 0.123
  }
}
```

### With SSI Validation (`SSI_VALIDATION=true`)

```json
{
  "trade_event_id": "9a7b...e1",
  "symbol": "BINANCE:BTCUSDT",
  "start_timestamp": "2025-09-09T10:10:45.012345Z",
  "tradeCredential": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "id": "vc:BINANCE:BTCUSDT:550e8400-e29b-41d4-a716-446655440000",
    "type": ["VerifiableCredential"],
    "issuer": { "id": "did:key:z6M..." },
    "issuanceDate": "2025-09-09T10:10:45Z",
    "credentialSubject": {
      "id": "did:key:z6M...",
      "claims": { "TradeData": { /* trade fields */ } }
    },
    "proof": { "type": "JwtProof2020", "jwt": "eyJ..." }
  }
}
```

## Metrics

All metrics are prefixed with `data_synthesizer_` and include labels: `did_provider`, `ssi_validation`, `cache_did`, `processing_mode`.

### Key Metric Categories

- **Performance**: End-to-end latency, payload sizes, processing duration
- **Trade Processing**: Trades processed, batch processing times, success/failure rates
- **WebSocket**: Active connections, message rates, processing times
- **Broadcasting**: Broadcast duration, timeout counts per symbol
- **Signing**: Credential signing duration and error rates
- **Veramo API**: Request duration, success/error rates by endpoint
- **System**: Active processors, connection health

Access metrics at: `http://localhost:2122/metrics`

## Architecture

### Core Components

- **`service/finnhub/client.go`** — WebSocket connection management and message handling
- **`service/trade_processor.go`** — Trade processing, signing, and broadcasting orchestration
- **`service/websocket/ws.go`** — Client connection management and message broadcasting
- **`service/veramo/`** — DID management and Verifiable Credential issuance
- **`service/metrics/`** — Prometheus metrics collection and serving
- **`config/config.go`** — Environment configuration management

### Startup Process

1. Load configuration from environment variables
2. Bootstrap DIDs per symbol (parallel processing)
3. Connect to Finnhub WebSocket and subscribe to tickers
4. Start HTTP server for health checks and WebSocket endpoint
5. Start metrics server on separate port
6. Process incoming trades with optional VC signing
7. Broadcast processed events to all connected WebSocket clients

## Troubleshooting

### Common Issues

**Service won't start**: Ensure all required environment variables are set (`FINNHUB_API_KEY`, `TICKERS`, `VERAMO_API_URL`, `VERAMO_API_TOKEN`). For did:web, also set `DID_WEB_HOST`.

**No WebSocket messages**: Verify Finnhub API key is valid and tickers are supported. Check `/health` endpoint and look for subscription confirmations in logs.

**Signing errors**: Confirm Veramo API URL and token are correct. For did:web, ensure host and project combination is valid and accessible.

**Early termination**: Check if `MESSAGE_COUNT` limit was reached. Set to `0` for unlimited processing.

**Metrics unavailable**: Verify metrics port (default 2122) is accessible and not conflicting with other services.

## Development

The service uses Docker multi-stage builds and includes `sample.env` as defaults. Environment variables set at run time through docker compose or when using `docker run -e` override these defaults.

For network connectivity between containers, ensure they're on the same Docker network when using service names for inter-container communication.
