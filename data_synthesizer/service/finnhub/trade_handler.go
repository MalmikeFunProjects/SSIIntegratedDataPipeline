// service/trade_processor.go
package finnhub

import (
	"context"
	"data_synthesizer/config"
	"data_synthesizer/models"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"data_synthesizer/service/metrics"
	"data_synthesizer/service/veramo"
	"data_synthesizer/service/websocket"

	"github.com/prometheus/client_golang/prometheus"
)

// TradeProcessor is a concrete implementation of TradeHandler
type TradeProcessor struct {
	identityInformation *veramo.IdentityInformation
	processedCount      int
	mu                  sync.RWMutex
	ctx                 context.Context
	cancel              context.CancelFunc
	wg                  sync.WaitGroup
	closed              bool
	ssiValidation       bool
}

// NewTradeProcessor creates a new trade processor
func NewTradeProcessor(identity *veramo.IdentityInformation, config *config.Config) *TradeProcessor {
	ctx, cancel := context.WithCancel(context.Background())
	return &TradeProcessor{
		identityInformation: identity,
		ctx:                 ctx,
		cancel:              cancel,
		ssiValidation:       config.SSIValidation,
	}
}

func structToMap(data interface{}) (map[string]interface{}, error) {
	bytes, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	var result map[string]interface{}
	if err := json.Unmarshal(bytes, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (tp *TradeProcessor) SignPayload(trade models.FinnhubTrade) (map[string]interface{}, error) {
	timer := prometheus.NewTimer(metrics.CredentialSigningDuration.WithLabelValues(trade.Symbol))
	defer timer.ObserveDuration()

	tradeMap, err := structToMap(trade)
	if err != nil {
		metrics.CredentialSigningErrors.WithLabelValues(trade.Symbol, "struct_conversion").Inc()
		log.Printf("❌ Error converting trade struct to map for symbol %s: %v", trade.Symbol, err)
		return nil, fmt.Errorf("failed to convert trade struct to map for symbol %s: %w", trade.Symbol, err)
	}

	tradeData := map[string]interface{}{
		"TradeData": tradeMap,
	}

	authorizationCredentialJWT := tp.identityInformation.GetAuthourizationCredentialJWT(trade.Symbol)
	didIdentifier, err := tp.identityInformation.GetDidIdentifier(trade.Symbol)
	if err != nil {
		metrics.CredentialSigningErrors.WithLabelValues(trade.Symbol, "did_retrieval").Inc()
		log.Printf("❌ Error retrieving the did identifier for symbol %s: %v", trade.Symbol, err)
		return nil, fmt.Errorf("error retrieving the did identifier for symbol %s: %v", trade.Symbol, err)
	}

	issuer := didIdentifier.DID
	subjectDID := didIdentifier.DID

	// Sign the sensor data using the device DID's key
	trade_vc, err := tp.identityInformation.Client.IssueVC(issuer, subjectDID, tradeData, trade.Symbol, authorizationCredentialJWT)
	if err != nil {
		metrics.CredentialSigningErrors.WithLabelValues(trade.Symbol, "vc_issuance").Inc()
		log.Printf("❌ Error signing sensor data: %v", err)
		return nil, err
	}

	var tradeCredential map[string]interface{}
	if err := json.Unmarshal(trade_vc, &tradeCredential); err != nil {
		metrics.CredentialSigningErrors.WithLabelValues(trade.Symbol, "json_unmarshal").Inc()
		return nil, err
	}
	return tradeCredential, nil
}

// HandleTrade processes a single trade
func (tp *TradeProcessor) HandleTrade(trade models.FinnhubTrade, startTimestamp time.Time) error {
	timer := prometheus.NewTimer(metrics.TradeProcessingDuration.WithLabelValues(trade.Symbol, "processing"))
	defer timer.ObserveDuration()

	// Check if processor is shutting down
	select {
	case <-tp.ctx.Done():
		metrics.TradeProcessingDuration.WithLabelValues(trade.Symbol, "cancelled").Observe(0)
		metrics.TradesProcessedTotal.WithLabelValues(trade.Symbol, "cancelled").Inc()
		return fmt.Errorf("trade processor is shutting down")
	default:
	}

	tp.mu.RLock()
	if tp.closed {
		tp.mu.RUnlock()
		metrics.TradeProcessingDuration.WithLabelValues(trade.Symbol, "closed").Observe(0)
		metrics.TradesProcessedTotal.WithLabelValues(trade.Symbol, "failed").Inc()
		return fmt.Errorf("trade processor is closed")
	}
	tp.mu.RUnlock()

	payload := map[string]interface{}{
		"trade_event_id":              trade.Trade_Id,
		"symbol":          trade.Symbol,
		"start_timestamp": startTimestamp,
	}

	if !tp.ssiValidation {
		tradeMap, err := structToMap(trade)
		if err != nil {
			metrics.CredentialSigningErrors.WithLabelValues(trade.Symbol, "struct_conversion").Inc()
			log.Printf("❌ Error converting trade struct to map for symbol %s: %v", trade.Symbol, err)
			return fmt.Errorf("failed to convert trade struct to map for symbol %s: %w", trade.Symbol, err)
		}
		payload["tradeData"] = tradeMap
	} else {
		tradeCredential, err := tp.SignPayload(trade)
		if err != nil {
			metrics.TradeProcessingDuration.WithLabelValues(trade.Symbol, "sign_error").Observe(0)
			metrics.TradesProcessedTotal.WithLabelValues(trade.Symbol, "failed").Inc()
			log.Printf("❌ Error signing trade for symbol %s: %v", trade.Symbol, err)
			return fmt.Errorf("failed to sign trade for symbol %s: %w", trade.Symbol, err)
		}
		payload["tradeCredential"] = tradeCredential
	}

	jsonData, _ := json.Marshal(payload)

	// // Observe payload size
	metrics.PayloadSizeBytes.Observe(float64(len(jsonData)))

	// Measure broadcast duration
	broadcastTimer := prometheus.NewTimer(metrics.BroadcastDuration.WithLabelValues(trade.Symbol))
	defer broadcastTimer.ObserveDuration()

	// Check context before broadcasting
	select {
	case <-tp.ctx.Done():
		metrics.TradesProcessedTotal.WithLabelValues(trade.Symbol, "cancelled").Inc()
		return fmt.Errorf("trade processor is shutting down, skipping broadcast")
	case websocket.Broadcast <- jsonData:
		// Successfully sent
		metrics.TradesProcessedTotal.WithLabelValues(trade.Symbol, "success").Inc()
	case <-time.After(time.Second * 5):
		metrics.BroadcastTimeouts.WithLabelValues(trade.Symbol).Inc()
		metrics.TradesProcessedTotal.WithLabelValues(trade.Symbol, "timeout").Inc()
		log.Printf("⚠️ Broadcast timeout for symbol %s", trade.Symbol)
		return fmt.Errorf("broadcast timeout for symbol %s", trade.Symbol)
	}

	tp.mu.Lock()
	tp.processedCount++

	duration := time.Now().UTC().Sub(startTimestamp)
	metrics.EndToEndLatency.Observe(duration.Seconds())
	log.Printf("%s\n", strings.Repeat("=", 50))
	log.Printf("✅ Trade processed for symbol %s, total processed: %d", trade.Symbol, tp.processedCount)
	// log.Printf("Processed trade for symbol %s: %s", trade.Symbol, jsonData)
	log.Printf("%s\n\n", strings.Repeat("=", 50))
	tp.mu.Unlock()
	return nil
}

// HandleBatch processes multiple trades efficiently with proper error handling
func (tp *TradeProcessor) HandleBatch(trades []models.FinnhubTrade, timestamp time.Time) error {
	timer := prometheus.NewTimer(metrics.BatchProcessingDuration.WithLabelValues(fmt.Sprintf("%d", len(trades))))
	defer timer.ObserveDuration()

	tp.wg.Add(1)
	defer tp.wg.Done()

	var errors []error
	for _, trade := range trades {
		// Check if we should stop processing
		select {
		case <-tp.ctx.Done():
			log.Printf("Batch processing interrupted, processed %d out of %d trades",
				len(trades)-len(errors), len(trades))
			return fmt.Errorf("batch processing interrupted: %w", tp.ctx.Err())
		default:
		}

		if err := tp.HandleTrade(trade, timestamp); err != nil {
			errors = append(errors, err)
			log.Printf("❌ Error processing trade for symbol %s: %v", trade.Symbol, err)
		}
	}

	if len(errors) > 0 {
		return fmt.Errorf("encountered %d errors during batch processing (first error: %w)",
			len(errors), errors[0])
	}

	return nil
}

// Close cleanup resources with timeout
func (tp *TradeProcessor) Close() error {
	tp.mu.Lock()
	if tp.closed {
		tp.mu.Unlock()
		return nil // Already closed
	}
	tp.closed = true
	processedCount := tp.processedCount
	tp.mu.Unlock()

	log.Printf("🔄 Trade processor shutting down. Processed %d trades total.", processedCount)

	// Cancel context to signal shutdown
	tp.cancel()

	// Wait for in-flight operations with timeout
	done := make(chan struct{})
	go func() {
		tp.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Printf("✅ All trade processing operations completed successfully")
	case <-time.After(30 * time.Second):
		log.Printf("⚠️ Timeout waiting for trade processing operations to complete")
		return fmt.Errorf("timeout waiting for operations to complete")
	}

	// Final metrics report
	log.Printf("📊 Final trade processor stats - Total processed: %d", processedCount)

	return nil
}

// GetProcessedCount returns the number of processed trades
func (tp *TradeProcessor) GetProcessedCount() int {
	tp.mu.RLock()
	defer tp.mu.RUnlock()
	return tp.processedCount
}

// IsRunning returns whether the processor is still active
func (tp *TradeProcessor) IsRunning() bool {
	tp.mu.RLock()
	defer tp.mu.RUnlock()
	return !tp.closed
}
