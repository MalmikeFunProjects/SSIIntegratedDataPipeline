package metrics

import (
	"data_synthesizer/config"
	"fmt"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Global variable to hold default metrics instance
var DefaultMetrics *defaultMetrics

// Initialize metrics with config - call this from main.go
func Initialize(cfg *config.Config) {
	DefaultMetrics = newDefaultMetrics(cfg)
	initializeMetrics()
}

var (
	EndToEndLatency                    prometheus.Histogram
	PayloadSizeBytes                   prometheus.Histogram
	TradeProcessingDuration            *prometheus.HistogramVec
	TradesProcessedTotal               *prometheus.CounterVec
	BatchProcessingDuration            *prometheus.HistogramVec
	WebsocketConnectionsActive         prometheus.Gauge
	WebsocketMessagesReceived          *prometheus.CounterVec
	WebsocketMessageProcessingDuration *prometheus.HistogramVec
	BroadcastDuration                  *prometheus.HistogramVec
	BroadcastTimeouts                  *prometheus.CounterVec
	CredentialSigningDuration          *prometheus.HistogramVec
	CredentialSigningErrors            *prometheus.CounterVec
	VeramoAPIDuration                  *prometheus.HistogramVec
	VeramoAPIRequestsTotal             *prometheus.CounterVec
	VeramoAPIRequestErrors             *prometheus.CounterVec
	ActiveTradeProcessors              prometheus.Gauge
	FinnhubConnectionDuration          prometheus.Histogram
	FinnhubSubscriptionErrors          *prometheus.CounterVec
)

var METRIC_PREFIX = "data_synthesizer_";

func metricName(name string) string{
	return fmt.Sprintf("%s%s", METRIC_PREFIX, name)
}

func initializeMetrics() {
	EndToEndLatency = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:        metricName("finnhub_end_to_end_latency_seconds"),
		Help:        "End-to-end latency for finnhub data processing.",
		Buckets:     prometheus.DefBuckets,
		ConstLabels: DefaultMetrics.getDefaultLabels(),
	})

	PayloadSizeBytes = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:        metricName("finnhub_payload_size_bytes"),
		Help:        "Size of signed sensor payloads sent over WebSocket.",
		Buckets:     prometheus.ExponentialBuckets(256, 2, 10), // 256B up to ~128KB
		ConstLabels: DefaultMetrics.getDefaultLabels(),
	})

	// Trade processing metrics
	TradeProcessingDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        metricName("trade_processing_duration_seconds"),
			Help:        "Time spent processing individual trades",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol", "status"},
	)

	TradesProcessedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("trades_processed_total"),
			Help:        "Total number of trades processed",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol", "status"},
	)

	BatchProcessingDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        metricName("batch_processing_duration_seconds"),
			Help:        "Time spent processing trade batches",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"batch_size"},
	)

	// WebSocket metrics
	WebsocketConnectionsActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name:        metricName("websocket_connections_active"),
			Help:        "Number of active WebSocket connections",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
	)

	WebsocketMessagesReceived = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("websocket_messages_received_total"),
			Help:        "Total number of WebSocket messages received",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"message_type"},
	)

	WebsocketMessageProcessingDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        metricName("websocket_message_processing_duration_seconds"),
			Help:        "Time spent processing WebSocket messages",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"message_type"},
	)

	// Broadcasting metrics
	BroadcastDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        metricName("broadcast_duration_seconds"),
			Help:        "Time spent broadcasting messages",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol"},
	)

	BroadcastTimeouts = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("broadcast_timeouts_total"),
			Help:        "Total number of broadcast timeouts",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol"},
	)

	// Credential signing metrics
	CredentialSigningDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        metricName("credential_signing_duration_seconds"),
			Help:        "Time spent signing trade credentials",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol"},
	)

	CredentialSigningErrors = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("credential_signing_errors_total"),
			Help:        "Total number of credential signing errors",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol", "error_type"},
	)

	// Veramo API metrics
	VeramoAPIDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        metricName("veramo_api_duration_seconds"),
			Help:        "Time spent on Veramo API requests",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"endpoint", "method", "status_code"},
	)

	VeramoAPIRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("veramo_api_requests_total"),
			Help:        "Total number of Veramo API requests",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"endpoint", "method", "status_code"},
	)

	VeramoAPIRequestErrors = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("veramo_api_request_errors_total"),
			Help:        "Total number of failed Veramo API requests",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"method", "endpoint"},
	)

	// System metrics
	ActiveTradeProcessors = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name:        metricName("trade_processors_active"),
			Help:        "Number of active trade processors",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
	)

	// Finnhub client metrics
	FinnhubConnectionDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:        metricName("finnhub_connection_duration_seconds"),
			Help:        "Time spent establishing Finnhub connection",
			Buckets:     prometheus.DefBuckets,
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
	)

	FinnhubSubscriptionErrors = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name:        metricName("finnhub_subscription_errors_total"),
			Help:        "Total number of Finnhub subscription errors",
			ConstLabels: DefaultMetrics.getDefaultLabels(),
		},
		[]string{"symbol"},
	)
}

type defaultMetrics struct {
	defaultLabels prometheus.Labels
}

func bool_string(val bool) string {
	if val {
		return "true"
	}
	return "false"
}

func newDefaultMetrics(cfg *config.Config) *defaultMetrics {
	defaultLabels := prometheus.Labels{
		"did_provider":   cfg.DidProvider,
		"ssi_validation": bool_string(cfg.SSIValidation),
		"cache_did":      bool_string(cfg.CacheDid),
		"processing_mode": cfg.ProcessingMode,
	}
	return &defaultMetrics{
		defaultLabels: defaultLabels,
	}
}

func (dm *defaultMetrics) getDefaultLabels() prometheus.Labels {
	return dm.defaultLabels
}

// StartMetricsServer starts the Prometheus metrics HTTP server
func StartMetricsServer(port string) {
	http.Handle("/metrics", promhttp.Handler())
	go func() {
		if err := http.ListenAndServe(":"+port, nil); err != nil {
			// Log error appropriately in your application
			panic(err)
		}
	}()
}
