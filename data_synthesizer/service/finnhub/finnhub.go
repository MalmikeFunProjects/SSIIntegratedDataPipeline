package finnhub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus"

	"data_synthesizer/models"
	"data_synthesizer/service/metrics"
)


const (
	// WebSocket connection timeout
	dialTimeout = 10 * time.Second
	// Write timeout for sending messages
	writeTimeout = 10 * time.Second
	// Read timeout for receiving messages
	readTimeout = 60 * time.Second
)

type FinnhubClient struct {
	apiKey       string
	tickers      []string
	maxMessages  int
	messageCount int
	keyName      string
	columnMap    map[string]string
	wsConn       *websocket.Conn
	mu           sync.RWMutex
	tradeHandler models.TradeHandler
}

// NewFinnhubClient creates a new Finnhub WebSocket client
func NewFinnhubClient(apiKey string, tickers []string, maxMessages int, handler models.TradeHandler) *FinnhubClient {
	return &FinnhubClient{
		apiKey:      apiKey,
		tickers:     tickers,
		maxMessages: maxMessages,
		keyName:     "Symbol",
		columnMap: map[string]string{
			"c": "Trade_Condition",
			"p": "Price",
			"s": "Symbol",
			"t": "Event_Timestamp",
			"v": "Volume",
		},
		tradeHandler: handler,
	}
}

// Connect establishes WebSocket connection and subscribes to tickers
func (fc *FinnhubClient) Connect(ctx context.Context) error {
	timer := prometheus.NewTimer(metrics.FinnhubConnectionDuration)
	defer timer.ObserveDuration()

	url := fmt.Sprintf("wss://ws.finnhub.io?token=%s", fc.apiKey)

	dialer := &websocket.Dialer{
		HandshakeTimeout: dialTimeout,
	}

	conn, _, err := dialer.DialContext(ctx, url, nil)
	if err != nil {
		return fmt.Errorf("failed to connect to WebSocket: %w", err)
	}

	fc.wsConn = conn
	log.Printf("Connected to Finnhub WebSocket")

	// Configure connection timeouts
	conn.SetReadDeadline(time.Now().Add(readTimeout))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(readTimeout))
		return nil
	})

	// Subscribe to all tickers
	if err := fc.subscribe(); err != nil {
		conn.Close()
		return fmt.Errorf("failed to subscribe to tickers: %w", err)
	}

	return nil
}

// subscribe sends subscription messages for all configured tickers
func (fc *FinnhubClient) subscribe() error {
	for _, ticker := range fc.tickers {
		subMsg := models.SubscribeMessage{
			Type:   "subscribe",
			Symbol: ticker,
		}

		fc.wsConn.SetWriteDeadline(time.Now().Add(writeTimeout))
		if err := fc.wsConn.WriteJSON(subMsg); err != nil {
			metrics.FinnhubSubscriptionErrors.WithLabelValues(ticker).Inc()
			return fmt.Errorf("failed to subscribe to %s: %w", ticker, err)
		}

		log.Printf("Subscribed to %s", ticker)
	}
	return nil
}

// Start begins processing WebSocket messages
func (fc *FinnhubClient) Start(parentCtx context.Context) error {
	if fc.wsConn == nil {
		return fmt.Errorf("not connected - call Connect() first")
	}

	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel()

	// Start message processing goroutine
	go fc.readMessages(ctx, cancel)

	// Start ping handler
	go fc.pingHandler(ctx)

	// Wait for context cancellation
	<-ctx.Done()
	log.Println("Context cancelled, shutting down...")
	return fc.Close()
}

// readMessages processes incoming WebSocket messages
func (fc *FinnhubClient) readMessages(ctx context.Context, cancel context.CancelFunc) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			_, message, err := fc.wsConn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
					log.Println("WebSocket connection closed")
				} else {
					log.Printf("Error reading message: %v", err)
				}
				cancel()
				return
			}

			if err := fc.processMessage(message); err != nil {
				log.Printf("Error processing message: %v", err)
				continue
			}

			// Check if we've reached the message limit
			fc.mu.RLock()
			count := fc.messageCount
			max := fc.maxMessages
			fc.mu.RUnlock()

			if max > 0 && count >= max {
				log.Printf("Reached message limit of %d messages", max)
				cancel() // Cancel the context to stop processing
				return
			}
		}
	}
}

// processMessage handles individual WebSocket messages
func (fc *FinnhubClient) processMessage(message []byte) error {
	timer := prometheus.NewTimer(metrics.WebsocketMessageProcessingDuration.WithLabelValues("unknown"))
	defer timer.ObserveDuration()

	var msg models.TradeMessage
	if err := json.Unmarshal(message, &msg); err != nil {
		metrics.WebsocketMessagesReceived.WithLabelValues("parse_error").Inc()
		return fmt.Errorf("JSON decode error: %w", err)
	}

	// Update timer with actual message type
	timer = prometheus.NewTimer(metrics.WebsocketMessageProcessingDuration.WithLabelValues(msg.Type))
	defer timer.ObserveDuration()

	switch msg.Type {
	case "ping":
		metrics.WebsocketMessagesReceived.WithLabelValues("ping").Inc()
		log.Println("Received ping")
		return nil
	case "trade":
		metrics.WebsocketMessagesReceived.WithLabelValues("trade").Inc()
		return fc.processTrades(msg.Data)
	default:
		metrics.WebsocketMessagesReceived.WithLabelValues("unknown").Inc()
		log.Printf("Unknown message type: %s", msg.Type)
		return nil
	}
}


// processTrades handles trade data messages
func (fc *FinnhubClient) processTrades(trades []models.FinnhubTradeRaw) error {
	for _, record := range trades {
		record.EnsureDefaults()
		startTimestamp  := time.Now().UTC()
		trade := fc.mapRecord(record)
		err := fc.tradeHandler.HandleTrade(trade, startTimestamp)
		if err != nil {
			log.Printf("Error handling trade for %s: %v", record.Symbol, err)
			continue
		}

		fc.mu.Lock()
		fc.messageCount++
		fc.mu.Unlock()
	}
	return nil
}

func (fc *FinnhubClient) mapRecord(record models.FinnhubTradeRaw) models.FinnhubTrade {
	// Map raw trade data to structured format
	return models.FinnhubTrade(record)
}

// pingHandler sends periodic ping messages to keep connection alive
func (fc *FinnhubClient) pingHandler(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fc.wsConn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := fc.wsConn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Failed to send ping: %v", err)
				return
			}
		}
	}
}

// Close gracefully closes the WebSocket connection
func (fc *FinnhubClient) Close() error {
	var err error

	// Close the trade handler first
	if fc.tradeHandler != nil {
		if handlerErr := fc.tradeHandler.Close(); handlerErr != nil {
			log.Printf("Error closing trade handler: %v", handlerErr)
			err = handlerErr
		}
	}

	// Close WebSocket connection
	if fc.wsConn != nil {
		fc.wsConn.SetWriteDeadline(time.Now().Add(writeTimeout))
		closeErr := fc.wsConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		if closeErr != nil {
			log.Printf("Error sending close message: %v", closeErr)
		}

		if connErr := fc.wsConn.Close(); connErr != nil && err == nil {
			err = connErr
		}
	}

	return err
}

// GetMessageCount returns the current message count (thread-safe)
func (fc *FinnhubClient) GetMessageCount() int {
	fc.mu.RLock()
	defer fc.mu.RUnlock()
	return fc.messageCount
}

