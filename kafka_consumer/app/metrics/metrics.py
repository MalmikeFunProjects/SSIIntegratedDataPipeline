import threading
from prometheus_client import Counter, Histogram, Gauge, Info
import app.utils.settings as Utils


class Metrics:
    _instance = None
    _lock = threading.Lock()
    METRIC_PREFIX = "kafka_consumer_"

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialize_metrics()
        return cls._instance

    def metricName(self, name: str)->str:
        return f"{self.METRIC_PREFIX}{name}"


    def getCacheDid(self):
        did_provider = Utils.DID_PROVIDER
        return Utils.CACHE_DID or did_provider.startswith("did:ethr")

    def _initialize_metrics(self):
        did_provider = Utils.DID_PROVIDER
        ssi_validation = Utils.SSI_VALIDATION
        cache_did = self.getCacheDid()
        processing_mode = Utils.PROCESSING_MODE

        self._common_labels = {
            "did_provider": did_provider,
            "ssi_validation": "true" if ssi_validation else "false",
            "cache_did": cache_did,
            "processing_mode": processing_mode,
        }

        # Message processing metrics
        self.messages_consumed_total = Counter(
            self.metricName('kafka_messages_consumed_total'),
            'Total number of messages consumed from Kafka',
            ['topic', 'status', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        self.message_processing_duration = Histogram(
            self.metricName('kafka_message_processing_duration_seconds'),
            'Time spent processing a single message',
            ['topic', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
            buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
        )

        # End-to-end latency metrics
        self.end_to_end_latency = Histogram(
            self.metricName('message_end_to_end_latency_seconds'),
            'End-to-end latency from message creation to processing',
            ['did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0],
        )

        # Throughput metrics
        self.messages_per_second = Gauge(
            self.metricName('kafka_messages_per_second'),
            'Current messages processed per second',
            ['topic', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        # Error metrics
        self.processing_errors_total = Counter(
            self.metricName('kafka_processing_errors_total'),
            'Total number of message processing errors',
            ['topic', 'error_type', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        self.deserialization_errors_total = Counter(
            self.metricName('kafka_deserialization_errors_total'),
            'Total number of message deserialization errors',
            ['topic', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        # Veramo client metrics
        self.veramo_requests_total = Counter(
            self.metricName('veramo_requests_total'),
            'Total number of requests to Veramo service',
            ['endpoint', 'status_code', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        self.veramo_request_duration = Histogram(
            self.metricName('veramo_request_duration_seconds'),
            'Duration of Veramo API requests',
            ['endpoint', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
        )

        # Consumer health metrics
        self.consumer_lag = Gauge(
            self.metricName('kafka_consumer_lag'),
            'Consumer lag in seconds (time since last message)',
            ['topic', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        self.active_consumers = Gauge(
            self.metricName('kafka_active_consumers'),
            'Number of active Kafka consumers',
            ['did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        # Application info
        self.application_info = Info(
            self.metricName('kafka_consumer_application_info'),
            'Information about the Kafka consumer application',
            ['did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

        # Message size metrics
        self.message_size_bytes = Histogram(
            self.metricName('kafka_message_size_bytes'),
            'Size of Kafka messages in bytes',
            ['topic', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
            buckets=[100, 500, 1000, 5000, 10000, 50000, 100000, 500000],
        )

        # Credential verification metrics
        self.credential_verification_duration = Histogram(
            self.metricName('credential_verification_duration_seconds'),
            'Time spent verifying credentials',
            ['did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0],
        )

        self.credential_verification_results = Counter(
            self.metricName('credential_verification_results_total'),
            'Results of credential verification',
            ['result', 'did_provider', 'ssi_validation', 'cache_did', 'processing_mode'],
        )

    # Helper: always inject common labels
    def labels(self, metric, **labels):
        return metric.labels(**{**labels, **self._common_labels})


# Global metrics instance
metrics = Metrics()
