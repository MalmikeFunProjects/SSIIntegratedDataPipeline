package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"data_synthesizer/config"
	"data_synthesizer/service/finnhub"
	"data_synthesizer/service/metrics"
	"data_synthesizer/service/veramo"
	"data_synthesizer/service/websocket"
)

func healthHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"status": "healthy"}`))
}

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err) // centralized fatal handling
	}

	log.Printf("KMS: %s", cfg.KMS)
	log.Printf("Veramo URL: %s", cfg.VeramoURL)
	log.Printf("DidProvider: %s", cfg.DidProvider)

	// Initialize prometheus metrics
	metrics.Initialize(&cfg)

	// Create context for graceful shutdown
	ctx, cancel := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM, syscall.SIGQUIT)
	defer cancel()

	veramoClient := veramo.NewClient(&cfg)

	identity, err := veramo.BootstrapDevice(veramoClient, cfg.KMS, cfg.DidProvider, cfg.Tickers, cfg.DidWebHost, cfg.DidWebProject)
	if err != nil {
		log.Fatalf("❌ Error initializing identity: %v", err)
	}


	handler := finnhub.NewTradeProcessor(identity, &cfg)
	metrics.ActiveTradeProcessors.Inc()

	// Create and configure client
	client := finnhub.NewFinnhubClient(cfg.ApiKey, cfg.Tickers, cfg.MessageCount, handler)

    log.Printf("Health server running on http://localhost:%s/health", cfg.Port)
    log.Printf("WebSocket server started on ws://localhost:%s/ws", cfg.Port)
    log.Printf("🔐 Number of credentials: %d...", len(identity.Credentials))
	http.HandleFunc("/health", healthHandler)
    http.HandleFunc("/ws", websocket.HandleWebSocket)

	// Start HTTP server
    server := &http.Server{
        Addr:    fmt.Sprintf(":%s", cfg.Port),
        Handler: nil,
    }

	var wg sync.WaitGroup

	// Start HTTP server in goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer log.Printf("✔ Done: HTTP server stopped.")
        log.Printf("Starting HTTP server on :%s", cfg.Port)
        if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Printf("HTTP server error: %v", err)
        }
    }()

	// Start Finnhub client in goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer log.Printf("✔ Done: WebSocket client stopped.")
		// Connect to WebSocket
		if err := client.Connect(ctx); err != nil {
			log.Printf("Failed to connect: %v", err)
		}

		// Start processing messages
		if err := client.Start(ctx); err != nil {
			log.Printf("Client error: %v", err)
		}

		log.Printf("Processed %d messages. Client stopped.", client.GetMessageCount())
	}()

	go metrics.StartMetricsServer(cfg.MetricsPort)

	// Wait for either shutdown signal or goroutines to complete
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
		case <-ctx.Done():
			log.Println("Shutdown signal received, starting graceful shutdown...")
		case <-done:
			log.Println("All services completed, starting graceful shutdown...")
			cancel() // Cancel context to stop any remaining operations
	}

	// Shutdown HTTP server gracefully
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	// Ensure all goroutines are done
	<-done
	log.Println("Application shutdown complete")
}
