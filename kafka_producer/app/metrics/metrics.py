from prometheus_client import Counter, Histogram
import app.utils.settings as Utils

METRIC_PREFIX = "kafka_producer_"

def metricName(name: str)->str:
    return f"{METRIC_PREFIX}{name}"

def getCacheDid():
    did_provider = Utils.DID_PROVIDER
    return "true" if Utils.CACHE_DID or did_provider.startswith("did:ethr") else "false"

did_provider = Utils.DID_PROVIDER
ssi_validation = Utils.SSI_VALIDATION
cache_did = getCacheDid()
processing_mode = Utils.PROCESSING_MODE

common_labels = {
    "did_provider": did_provider,
    "ssi_validation": "true" if ssi_validation else "false",
    "cache_did": cache_did,
    "processing_mode": processing_mode,
}


def labels(metric, **labels):
    return metric.labels(**{**labels, **common_labels})

# Prometheus metrics
producer_requests_total = Counter(
    metricName('requests_total'),
    'Total Kafka messages produced',
    ['topic', 'did', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

producer_request_failures = Counter(
    metricName('request_failures_total'),
    'Total Kafka message production failures',
    ['topic', 'did', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

producer_request_duration_seconds = Histogram(
    metricName('request_duration_seconds'),
    'Kafka message production latency in seconds',
    ['topic', 'did', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

websocket_connections_total = Counter(
    metricName('websocket_connections_total'),
    'Total number of WebSocket connections opened',
    ['url', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

websocket_disconnections_total = Counter(
    metricName('websocket_disconnections_total'),
    'Total number of WebSocket disconnections',
    ['url', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

websocket_connection_errors_total = Counter(
    metricName('websocket_connection_errors_total'),
    'Total number of WebSocket connection errors',
    ['url', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

websocket_messages_received_total = Counter(
    metricName('websocket_messages_received_total'),
    'Total number of WebSocket messages received',
    ['url', 'did', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

websocket_connection_duration_seconds = Histogram(
    metricName('websocket_connection_duration_seconds'),
    'Duration of WebSocket connections in seconds',
    ['url', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)

websocket_timeouts_total = Counter (
    metricName('websocket_messages_timeout_total'),
    'Total number of timeouts for websocket',
    ['did_provider', 'ssi_validation', 'cache_did', 'processing_mode']
)
