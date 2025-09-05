package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	ApiKey        string
	Tickers       []string
	MessageCount  int
	VeramoURL     string
	VeramoToken   string
	DidProvider   string
	DidWebHost    string
	DidWebProject string
	Port          string
	KMS           string
	MetricsPort   string
	SSIValidation bool
	CacheDid      bool
	ProcessingMode string
}

const (
	defaultKMS          = "local"
	defaultPort         = "4200"
	defaultMetricsPort  = "2122"
	defaultMessageCount = 1000
)

// LoadConfig loads from .env (if present) and environment variables.
func LoadConfig() (Config, error) {
	_ = godotenv.Load() // ok if missing

	cfg := Config{
		KMS:           getEnvDefault("KMS", defaultKMS),
		Port:          getEnvDefault("PORT", defaultPort),
		MetricsPort:   getEnvDefault("METRICS_PORT", defaultMetricsPort),
		DidProvider:   getEnvDefault("DID_PROVIDER", "did:key"),
		MessageCount:  parseIntDefault("MESSAGE_COUNT", defaultMessageCount),
		SSIValidation: parseBoolDefault("SSI_VALIDATION", true),
	}

	var err error

	// Required strings
	if cfg.ApiKey, err = getEnvRequired("FINNHUB_API_KEY"); err != nil {
		return Config{}, err
	}
	if cfg.VeramoURL, err = getEnvRequired("VERAMO_API_URL"); err != nil {
		return Config{}, err
	}
	if cfg.VeramoToken, err = getEnvRequired("VERAMO_API_TOKEN"); err != nil {
		return Config{}, err
	}

	// TICKERS (required, CSV)
	tickersEnv, ok := lookupEnvTrim("TICKERS")
	if !ok || tickersEnv == "" {
		return Config{}, fmt.Errorf("environment variable %q is required", "TICKERS")
	}
	cfg.Tickers = splitCSV(tickersEnv)
	if len(cfg.Tickers) == 0 {
		return Config{}, fmt.Errorf("no valid tickers found in %q", "TICKERS")
	}

	cacheDid := parseBoolDefault("CACHE_DID", false)
	cfg.CacheDid = cacheDid || strings.HasPrefix(cfg.DidProvider, "did:ethr")

	// did:web specific requirements
	cfg.DidWebHost = getEnvDefault("DID_WEB_HOST", "")
	cfg.DidWebProject = getEnvDefault("DID_WEB_PROJECT", "")
	if cfg.DidProvider == "did:web" && strings.TrimSpace(cfg.DidWebHost) == "" {
		return Config{}, fmt.Errorf("%q is required when %q is %q", "DID_WEB_HOST", "DID_PROVIDER", "did:web")
	}
	processingMode := "sync"
	if getEnvDefault("PROCESSING_MODE", "sync") == "async" {
		processingMode = "async"
	}
	cfg.ProcessingMode = processingMode

	return cfg, nil
}

// --- helpers ---

func lookupEnvTrim(key string) (string, bool) {
	v, ok := os.LookupEnv(key)
	return strings.TrimSpace(v), ok
}

func getEnvDefault(key, def string) string {
	if v, ok := lookupEnvTrim(key); ok && v != "" {
		return v
	}
	return def
}

func getEnvRequired(key string) (string, error) {
	if v, ok := lookupEnvTrim(key); ok && v != "" {
		return v, nil
	}
	return "", fmt.Errorf("environment variable %q is required", key)
}

func parseIntDefault(key string, def int) int {
	v, ok := lookupEnvTrim(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		log.Printf("Invalid %s=%q, using default %d", key, v, def)
		return def
	}
	return n
}

func parseBoolDefault(key string, def bool) bool {
	v, ok := lookupEnvTrim(key)
	if !ok || v == "" {
		return def
	}
	switch strings.ToLower(v) {
	case "1", "t", "true", "yes", "y":
		return true
	case "0", "f", "false", "no", "n":
		return false
	default:
		return def
	}
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
