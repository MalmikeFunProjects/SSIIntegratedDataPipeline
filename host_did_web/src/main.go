// package main

// import (
// 	"bytes"
// 	"encoding/json"
// 	"fmt"
// 	"io"
// 	"log"
// 	"net/http"
// 	"os"
// 	"os/exec"
// 	"path/filepath"
// 	"regexp"
// 	"strings"
// 	"sync"

// 	"github.com/joho/godotenv"
// )

// // Config holds the service configuration
// type Config struct {
// 	ServerURL string
// 	Branch    string
// 	GitRemote string
// 	CommitMsg string
// 	DryRun    bool
// 	Port      string
// }

// // DIDRequest represents the JSON request body
// type DIDRequest struct {
// 	DID string `json:"did"`
// }

// // DIDResponse represents the JSON response
// type DIDResponse struct {
// 	Success bool   `json:"success"`
// 	Message string `json:"message"`
// 	Error   string `json:"error,omitempty"`
// }

// // DIDProcessor handles the DID document processing
// type DIDProcessor struct {
// 	config  Config
// 	gitMux  sync.Mutex // Mutex to serialize git operations
// }

// func main() {
// 	if err := godotenv.Load(); err != nil {
// 		log.Println("No .env file found, using environment variables")
// 	}
// 	config := loadConfig()
// 	processor := &DIDProcessor{config: config}

// 	http.HandleFunc("/process-did", processor.handleProcessDID)
// 	http.HandleFunc("/health", handleHealth)

// 	log.Printf("Starting DID Web Service on port %s", config.Port)
// 	log.Printf("Server URL: %s", config.ServerURL)
// 	log.Printf("Branch: %s", config.Branch)
// 	log.Printf("Dry Run: %t", config.DryRun)

// 	log.Fatal(http.ListenAndServe(":"+config.Port, nil))
// }

// func loadConfig() Config {
// 	return Config{
// 		ServerURL: getEnv("SERVER_URL", "http://localhost:3332"),
// 		Branch:    getEnv("BRANCH", "gh-pages"),
// 		GitRemote: getEnv("GIT_REMOTE", "origin"),
// 		CommitMsg: getEnv("COMMIT_MSG", "chore (did): update did:web document"),
// 		DryRun:    getEnv("DRY_RUN", "false") == "true",
// 		Port:      getEnv("PORT", "8080"),
// 	}
// }

// func getEnv(key, defaultValue string) string {
// 	if value := os.Getenv(key); value != "" {
// 		return value
// 	}
// 	return defaultValue
// }

// func handleHealth(w http.ResponseWriter, r *http.Request) {
// 	w.Header().Set("Content-Type", "application/json")
// 	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
// }

// func (p *DIDProcessor) handleProcessDID(w http.ResponseWriter, r *http.Request) {
// 	w.Header().Set("Content-Type", "application/json")

// 	if r.Method != http.MethodPost {
// 		p.sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
// 		return
// 	}

// 	var req DIDRequest
// 	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
// 		p.sendError(w, http.StatusBadRequest, "Invalid JSON request")
// 		return
// 	}

// 	if req.DID == "" {
// 		p.sendError(w, http.StatusBadRequest, "DID is required")
// 		return
// 	}

// 	if err := p.processDID(req.DID); err != nil {
// 		p.sendError(w, http.StatusInternalServerError, err.Error())
// 		return
// 	}

// 	response := DIDResponse{
// 		Success: true,
// 		Message: "DID document processed successfully",
// 	}
// 	json.NewEncoder(w).Encode(response)
// }

// func (p *DIDProcessor) sendError(w http.ResponseWriter, status int, message string) {
// 	w.WriteHeader(status)
// 	response := DIDResponse{
// 		Success: false,
// 		Error:   message,
// 	}
// 	json.NewEncoder(w).Encode(response)
// }

// func (p *DIDProcessor) processDID(did string) error {
// 	// Parse DID
// 	parsedDID, err := parseDID(did)
// 	if err != nil {
// 		return fmt.Errorf("failed to parse DID: %w", err)
// 	}

// 	// Validate host
// 	if !strings.HasSuffix(strings.ToLower(parsedDID.Host), ".github.io") {
// 		return fmt.Errorf("host '%s' is not a github.io host", parsedDID.Host)
// 	}

// 	// Build fetch URL
// 	fetchURL := p.buildFetchURL(parsedDID)
// 	log.Printf("Fetching DID document from: %s", fetchURL)

// 	// Fetch DID document
// 	didDoc, err := p.fetchDIDDocument(fetchURL, parsedDID.Host)
// 	if err != nil {
// 		return fmt.Errorf("failed to fetch DID document: %w", err)
// 	}

// 	// Determine target file path
// 	targetFile := p.determineTargetFile(parsedDID)
// 	log.Printf("Target file: %s", targetFile)

// 	// Save DID document
// 	if err := p.saveDIDDocument(didDoc, targetFile); err != nil {
// 		return fmt.Errorf("failed to save DID document: %w", err)
// 	}

// 	// Validate DID document ID
// 	if err := p.validateDIDDocumentID(targetFile, parsedDID); err != nil {
// 		log.Printf("Warning: %v", err)
// 	}

// 	// Git operations (serialized)
// 	if !p.config.DryRun {
// 		if err := p.performGitOperations(targetFile, parsedDID); err != nil {
// 			return fmt.Errorf("git operations failed: %w", err)
// 		}
// 	} else {
// 		log.Println("Dry run: skipping git operations")
// 	}

// 	return nil
// }

// type ParsedDID struct {
// 	Original  string
// 	Host      string
// 	Project   string
// 	PathSegs  []string
// 	HostLower string
// }

// func parseDID(did string) (*ParsedDID, error) {
// 	if !strings.HasPrefix(did, "did:web:") {
// 		return nil, fmt.Errorf("not a did:web DID: %s", did)
// 	}

// 	parts := strings.Split(did, ":")
// 	if len(parts) < 4 {
// 		return nil, fmt.Errorf("DID missing project segment: %s", did)
// 	}

// 	parsed := &ParsedDID{
// 		Original:  did,
// 		Host:      parts[2],
// 		Project:   parts[3],
// 		PathSegs:  parts[4:],
// 		HostLower: strings.ToLower(parts[2]),
// 	}

// 	return parsed, nil
// }

// func (p *DIDProcessor) buildFetchURL(parsed *ParsedDID) string {
// 	urlPath := parsed.Project
// 	if len(parsed.PathSegs) > 0 {
// 		urlPath = urlPath + "/" + strings.Join(parsed.PathSegs, "/")
// 	}
// 	return fmt.Sprintf("%s/%s/did.json", p.config.ServerURL, urlPath)
// }

// func (p *DIDProcessor) fetchDIDDocument(url, host string) ([]byte, error) {
// 	client := &http.Client{}
// 	req, err := http.NewRequest("GET", url, nil)
// 	if err != nil {
// 		return nil, err
// 	}

// 	// Set the Host header to the original host from the DID
// 	// This is crucial for the Veramo server to route the request correctly
// 	req.Host = host
// 	req.Header.Set("Host", host)

// 	log.Printf("Making request to %s with Host header: %s", url, host)

// 	resp, err := client.Do(req)
// 	if err != nil {
// 		return nil, err
// 	}
// 	defer resp.Body.Close()

// 	if resp.StatusCode != http.StatusOK {
// 		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
// 	}

// 	return io.ReadAll(resp.Body)
// }

// func (p *DIDProcessor) determineTargetFile(parsed *ParsedDID) string {
// 	// Trim PATH_SEGS that already exist in current working directory
// 	cwd, _ := os.Getwd()
// 	trimmedSegs := make([]string, len(parsed.PathSegs))
// 	copy(trimmedSegs, parsed.PathSegs)

// 	for len(trimmedSegs) > 0 {
// 		lastDir := filepath.Base(cwd)
// 		if lastDir == trimmedSegs[0] {
// 			trimmedSegs = trimmedSegs[1:]
// 			cwd = filepath.Dir(cwd)
// 		} else {
// 			break
// 		}
// 	}

// 	var targetDir string
// 	if len(trimmedSegs) > 0 {
// 		targetDir = strings.Join(trimmedSegs, "/")
// 	} else {
// 		targetDir = "."
// 	}

// 	return filepath.Join(targetDir, "did.json")
// }

// func (p *DIDProcessor) saveDIDDocument(data []byte, targetFile string) error {
// 	// Create directory if needed
// 	dir := filepath.Dir(targetFile)
// 	if err := os.MkdirAll(dir, 0755); err != nil {
// 		return err
// 	}

// 	// Format JSON if possible
// 	var formattedData []byte
// 	var jsonObj interface{}
// 	if err := json.Unmarshal(data, &jsonObj); err == nil {
// 		if formatted, err := json.MarshalIndent(jsonObj, "", "  "); err == nil {
// 			formattedData = formatted
// 		} else {
// 			formattedData = data
// 		}
// 	} else {
// 		log.Println("Warning: invalid JSON, saving raw")
// 		formattedData = data
// 	}

// 	return os.WriteFile(targetFile, formattedData, 0644)
// }

// func (p *DIDProcessor) validateDIDDocumentID(targetFile string, parsed *ParsedDID) error {
// 	data, err := os.ReadFile(targetFile)
// 	if err != nil {
// 		return err
// 	}

// 	var doc map[string]interface{}
// 	if err := json.Unmarshal(data, &doc); err != nil {
// 		return fmt.Errorf("could not parse DID document for validation")
// 	}

// 	docID, ok := doc["id"].(string)
// 	if !ok || docID == "" {
// 		return fmt.Errorf("no 'id' field found in DID document")
// 	}

// 	expectedID := fmt.Sprintf("did:web:%s:%s", parsed.Host, parsed.Project)
// 	if len(parsed.PathSegs) > 0 {
// 		expectedID = expectedID + ":" + strings.Join(parsed.PathSegs, ":")
// 	}

// 	if docID != expectedID {
// 		return fmt.Errorf("DID doc id mismatch: got %s, expected %s", docID, expectedID)
// 	}

// 	return nil
// }

// func (p *DIDProcessor) performGitOperations(targetFile string, parsed *ParsedDID) error {
// 	// Lock git operations to prevent concurrent git commands
// 	p.gitMux.Lock()
// 	defer p.gitMux.Unlock()

// 	log.Printf("🔒 Acquired git lock for %s", targetFile)

// 	// Check if remote exists
// 	if err := p.checkGitRemote(); err != nil {
// 		return err
// 	}

// 	// Get remote URL and validate
// 	remoteURL, err := p.getRemoteURL()
// 	log.Printf("Remote URL: %s", remoteURL)
// 	if err != nil {
// 		return err
// 	}

// 	ghUser, ghRepo, err := p.parseGitHubURL(remoteURL)
// 	if err != nil {
// 		return err
// 	}

// 	// Validate GitHub username matches expected
// 	expectedUser := strings.TrimSuffix(parsed.HostLower, ".github.io")
// 	if !strings.EqualFold(ghUser, expectedUser) {
// 		return fmt.Errorf("GitHub username mismatch: expected %s, got %s", expectedUser, ghUser)
// 	}

// 	// Validate repo name matches project
// 	if !strings.EqualFold(ghRepo, parsed.Project) {
// 		fmt.Printf("\nERROR:        repo name mismatch: expected %s, got %s", parsed.Project, ghRepo)
// 		return fmt.Errorf("repo name mismatch: expected %s, got %s", parsed.Project, ghRepo)
// 	}

// 	log.Printf("✅ Validation passed (user: %s, repo: %s)", ghUser, ghRepo)

// 	// Perform git operations
// 	if err := p.executeGitCommands(targetFile); err != nil {
// 		return err
// 	}

// 	log.Printf("✅ Pushed %s to %s", targetFile, p.config.Branch)
// 	return nil
// }

// func (p *DIDProcessor) checkGitRemote() error {
// 	cmd := exec.Command("git", "remote", "get-url", p.config.GitRemote)
// 	if err := cmd.Run(); err != nil {
// 		fmt.Printf("\nERROR:        remote '%s' not found", p.config.GitRemote)
// 		return fmt.Errorf("remote '%s' not found", p.config.GitRemote)
// 	}
// 	return nil
// }

// func (p *DIDProcessor) getRemoteURL() (string, error) {
// 	cmd := exec.Command("git", "remote", "get-url", p.config.GitRemote)
// 	output, err := cmd.Output()
// 	if err != nil {
// 		fmt.Printf("\nERROR:        failed to get remote URL: %v\n", err)
// 		return "", fmt.Errorf("failed to get remote URL: %w", err)
// 	}
// 	return strings.TrimSpace(string(output)), nil
// }

// func (p *DIDProcessor) parseGitHubURL(remoteURL string) (user, repo string, err error) {
// 	// SSH form: git@github.com:User/Repo.git
// 	sshRegex := regexp.MustCompile(`^git@github\.com:([^/]+)/([^/]+)(\.git)?$`)
// 	if matches := sshRegex.FindStringSubmatch(remoteURL); len(matches) >= 3 {
// 		user = matches[1]
// 		repo = strings.TrimSuffix(matches[2], ".git")
// 		return user, repo, nil
// 	}

// 	// HTTPS form: https://github.com/User/Repo(.git)
// 	httpsRegex := regexp.MustCompile(`^https://github\.com/([^/]+)/([^/]+)(\.git)?$`)
// 	if matches := httpsRegex.FindStringSubmatch(remoteURL); len(matches) >= 3 {
// 		user = matches[1]
// 		repo = strings.TrimSuffix(matches[2], ".git")
// 		return user, repo, nil
// 	}

// 	fmt.Printf("\nERROR:        remote is not a GitHub SSH/HTTPS URL: %s", remoteURL)
// 	return "", "", fmt.Errorf("remote is not a GitHub SSH/HTTPS URL: %s", remoteURL)
// }

// func (p *DIDProcessor) executeGitCommands(targetFile string) error {
// 	// Checkout branch
// 	if err := checkoutOrCreateBranch(p.config.Branch); err != nil {
// 		fmt.Printf("\nERROR:        failed to checkout branch %s: %v\n", p.config.Branch, err)
// 		return fmt.Errorf("failed to checkout branch %s: %w", p.config.Branch, err)
// 	}

// 	// Add file
// 	if err := exec.Command("git", "add", targetFile).Run(); err != nil {
// 		fmt.Printf("\nERROR:        failed to add file %s: %v\n", targetFile, err)
// 		return fmt.Errorf("failed to add file %s: %w", targetFile, err)
// 	}

// 	// Commit (allow empty commits)
// 	cmd := exec.Command("git", "diff", "--cached", "--quiet")
// 	if err := cmd.Run(); err == nil {
// 		// no staged changes, skip commit
// 		fmt.Println("No staged changes, skipping commit")
// 	} else {
// 		commitMsg := fmt.Sprintf("%s %s", p.config.CommitMsg, targetFile)
// 		if err := exec.Command("git", "commit", "-m", commitMsg).Run(); err != nil {
// 			fmt.Printf("\nERROR:        git commit failed: %v\n", err)
// 			return fmt.Errorf("git commit failed: %w", err)
// 		}
// 	}

// 	// Push
// 	if err := exec.Command("git", "push", "-u", p.config.GitRemote, p.config.Branch).Run(); err != nil {
// 		fmt.Printf("\nERROR:        failed to push to %s: %v\n", p.config.Branch, err)
// 		return fmt.Errorf("failed to push to %s: %w", p.config.Branch, err)
// 	}

// 	return nil
// }

// func checkoutOrCreateBranch(branch string) error {
// 	// Get current branch
// 	var out bytes.Buffer
// 	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
// 	cmd.Stdout = &out
// 	if err := cmd.Run(); err != nil {
// 		fmt.Printf("\nERROR:        failed to get current branch: %v\n", err)
// 		return fmt.Errorf("failed to get current branch: %w", err)
// 	}
// 	currentBranch := strings.TrimSpace(out.String())

// 	// Already on branch
// 	if currentBranch == branch {
// 		return nil
// 	}

// 	// Check if branch exists
// 	checkBranch := exec.Command("git", "rev-parse", "--verify", branch)
// 	if err := checkBranch.Run(); err != nil {
// 		// Branch does not exist → create new branch
// 		if err := exec.Command("git", "checkout", "-b", branch).Run(); err != nil {
// 			fmt.Printf("\nERROR:        failed to create branch %s: %v\n", branch, err)
// 			return fmt.Errorf("failed to create branch %s: %w", branch, err)
// 		}
// 	} else {
// 		// Branch exists → just switch to it
// 		if err := exec.Command("git", "checkout", branch).Run(); err != nil {
// 			fmt.Printf("\nERROR:        failed to checkout branch %s: %v\n", branch, err)
// 			return fmt.Errorf("failed to checkout branch %s: %w", branch, err)
// 		}
// 	}

// 	return nil
// }

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"
)

// Config holds the service configuration
type Config struct {
	ServerURL    string
	Branch       string
	GitRemote    string
	CommitMsg    string
	DryRun       bool
	Port         string
	BatchTimeout time.Duration // How long to wait before flushing batch
	BatchSize    int           // Maximum files per batch
}

// DIDRequest represents the JSON request body
type DIDRequest struct {
	DID string `json:"did"`
}

// DIDResponse represents the JSON response
type DIDResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// BatchItem represents a file to be committed
type BatchItem struct {
	TargetFile string
	ParsedDID  *ParsedDID
	ResponseCh chan error // Channel to send result back to request handler
}

// DIDProcessor handles the DID document processing
type DIDProcessor struct {
	config  Config
	gitMux  sync.Mutex     // Mutex to serialize git operations
	batchCh chan BatchItem // Channel for batching git operations
	batchWG sync.WaitGroup // Wait group for graceful shutdown
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}
	config := loadConfig()
	processor := &DIDProcessor{
		config:  config,
		batchCh: make(chan BatchItem, 100), // Buffer for batch items
	}

	// Start the git batch processor
	processor.batchWG.Add(1)
	go processor.gitBatchProcessor()

	http.HandleFunc("/process-did", processor.handleProcessDID)
	http.HandleFunc("/health", handleHealth)

	log.Printf("Starting DID Web Service on port %s", config.Port)
	log.Printf("Server URL: %s", config.ServerURL)
	log.Printf("Branch: %s", config.Branch)
	log.Printf("Dry Run: %t", config.DryRun)
	log.Printf("Batch Timeout: %v", config.BatchTimeout)
	log.Printf("Batch Size: %d", config.BatchSize)

	log.Fatal(http.ListenAndServe(":"+config.Port, nil))
}

func loadConfig() Config {
	batchTimeout, _ := time.ParseDuration(getEnv("BATCH_TIMEOUT", "5s"))
	batchSize := 10
	if size := getEnv("BATCH_SIZE", "10"); size != "" {
		fmt.Sscanf(size, "%d", &batchSize)
	}

	return Config{
		ServerURL:    getEnv("SERVER_URL", "http://localhost:3332"),
		Branch:       getEnv("BRANCH", "gh-pages"),
		GitRemote:    getEnv("GIT_REMOTE", "origin"),
		CommitMsg:    getEnv("COMMIT_MSG", "chore (did): update did:web documents"),
		DryRun:       getEnv("DRY_RUN", "false") == "true",
		Port:         getEnv("PORT", "8080"),
		BatchTimeout: batchTimeout,
		BatchSize:    batchSize,
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}

func (p *DIDProcessor) handleProcessDID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		p.sendError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req DIDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		p.sendError(w, http.StatusBadRequest, "Invalid JSON request")
		return
	}

	if req.DID == "" {
		p.sendError(w, http.StatusBadRequest, "DID is required")
		return
	}

	if err := p.processDID(req.DID); err != nil {
		p.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	response := DIDResponse{
		Success: true,
		Message: "DID document processed successfully",
	}
	json.NewEncoder(w).Encode(response)
}

func (p *DIDProcessor) sendError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	response := DIDResponse{
		Success: false,
		Error:   message,
	}
	json.NewEncoder(w).Encode(response)
}

func (p *DIDProcessor) processDID(did string) error {
	// Parse DID
	parsedDID, err := parseDID(did)
	if err != nil {
		return fmt.Errorf("failed to parse DID: %w", err)
	}

	// Validate host
	if !strings.HasSuffix(strings.ToLower(parsedDID.Host), ".github.io") {
		return fmt.Errorf("host '%s' is not a github.io host", parsedDID.Host)
	}

	// Build fetch URL
	fetchURL := p.buildFetchURL(parsedDID)
	log.Printf("Fetching DID document from: %s", fetchURL)

	// Fetch DID document
	didDoc, err := p.fetchDIDDocument(fetchURL, parsedDID.Host)
	if err != nil {
		return fmt.Errorf("failed to fetch DID document: %w", err)
	}

	// Determine target file path
	targetFile := p.determineTargetFile(parsedDID)
	log.Printf("Target file: %s", targetFile)

	// Save DID document
	if err := p.saveDIDDocument(didDoc, targetFile); err != nil {
		return fmt.Errorf("failed to save DID document: %w", err)
	}

	// Validate DID document ID
	if err := p.validateDIDDocumentID(targetFile, parsedDID); err != nil {
		log.Printf("Warning: %v", err)
	}

	// Git operations (batched)
	if !p.config.DryRun {
		if err := p.batchGitOperation(targetFile, parsedDID); err != nil {
			return fmt.Errorf("git operations failed: %w", err)
		}
	} else {
		log.Println("Dry run: skipping git operations")
	}

	return nil
}

// batchGitOperation adds the file to the batch queue and waits for completion
func (p *DIDProcessor) batchGitOperation(targetFile string, parsedDID *ParsedDID) error {
	responseCh := make(chan error, 1)

	batchItem := BatchItem{
		TargetFile: targetFile,
		ParsedDID:  parsedDID,
		ResponseCh: responseCh,
	}

	// Send to batch processor
	select {
	case p.batchCh <- batchItem:
		// Wait for response
		return <-responseCh
	case <-time.After(30 * time.Second):
		return fmt.Errorf("timeout waiting for git batch processor")
	}
}

// gitBatchProcessor processes git operations in batches
func (p *DIDProcessor) gitBatchProcessor() {
	defer p.batchWG.Done()

	var batch []BatchItem
	ticker := time.NewTicker(p.config.BatchTimeout)
	defer ticker.Stop()

	processBatch := func() {
		if len(batch) == 0 {
			return
		}

		log.Printf("Processing git batch with %d items", len(batch))

		// Process the batch
		err := p.performBatchedGitOperations(batch)

		// Send results back to all waiting requests
		for _, item := range batch {
			select {
			case item.ResponseCh <- err:
			default:
				// Channel might be closed if request timed out
			}
		}

		// Clear the batch
		batch = batch[:0]
		ticker.Reset(p.config.BatchTimeout)
	}

	for {
		select {
		case item, ok := <-p.batchCh:
			if !ok {
				// Channel closed, process final batch and exit
				processBatch()
				return
			}

			batch = append(batch, item)

			// Process batch if it reaches max size
			if len(batch) >= p.config.BatchSize {
				processBatch()
			}

		case <-ticker.C:
			// Timeout reached, process current batch
			processBatch()
		}
	}
}

// performBatchedGitOperations performs git operations for a batch of files
func (p *DIDProcessor) performBatchedGitOperations(batch []BatchItem) error {
	if len(batch) == 0 {
		return nil
	}

	// Lock git operations to prevent concurrent git commands
	p.gitMux.Lock()
	defer p.gitMux.Unlock()

	log.Printf("🔒 Acquired git lock for batch of %d files", len(batch))

	// Validate all items in batch first
	var validatedItems []BatchItem
	seenHosts := make(map[string]bool)

	for _, item := range batch {
		// Check if remote exists (only once per batch)
		if err := p.checkGitRemote(); err != nil {
			return err
		}

		// Get remote URL and validate (only once per host)
		hostKey := item.ParsedDID.HostLower
		if !seenHosts[hostKey] {
			remoteURL, err := p.getRemoteURL()
			if err != nil {
				return err
			}

			ghUser, ghRepo, err := p.parseGitHubURL(remoteURL)
			if err != nil {
				return err
			}

			// Validate GitHub username matches expected
			expectedUser := strings.TrimSuffix(item.ParsedDID.HostLower, ".github.io")
			if !strings.EqualFold(ghUser, expectedUser) {
				return fmt.Errorf("GitHub username mismatch: expected %s, got %s", expectedUser, ghUser)
			}

			// Validate repo name matches project
			if !strings.EqualFold(ghRepo, item.ParsedDID.Project) {
				return fmt.Errorf("repo name mismatch: expected %s, got %s", item.ParsedDID.Project, ghRepo)
			}

			seenHosts[hostKey] = true
			log.Printf("✅ Validation passed for host %s (user: %s, repo: %s)", hostKey, ghUser, ghRepo)
		}

		validatedItems = append(validatedItems, item)
	}

	// Perform batched git operations
	if err := p.executeBatchedGitCommands(validatedItems); err != nil {
		return err
	}

	log.Printf("✅ Pushed batch of %d files to %s", len(validatedItems), p.config.Branch)
	return nil
}

// executeBatchedGitCommands executes git commands for multiple files at once
func (p *DIDProcessor) executeBatchedGitCommands(batch []BatchItem) error {
	// Checkout branch
	if err := checkoutOrCreateBranch(p.config.Branch); err != nil {
		return fmt.Errorf("failed to checkout branch %s: %w", p.config.Branch, err)
	}

	// Add all files
	var filesToAdd []string
	for _, item := range batch {
		filesToAdd = append(filesToAdd, item.TargetFile)
	}

	// Add all files in one command
	addArgs := append([]string{"add"}, filesToAdd...)
	if err := exec.Command("git", addArgs...).Run(); err != nil {
		return fmt.Errorf("failed to add files: %w", err)
	}

	// Check if there are any staged changes
	cmd := exec.Command("git", "diff", "--cached", "--quiet")
	if err := cmd.Run(); err == nil {
		// No staged changes, skip commit
		log.Println("No staged changes in batch, skipping commit")
		return nil
	}

	// Create commit message listing all files
	var fileList []string
	for _, item := range batch {
		fileList = append(fileList, item.TargetFile)
	}
	commitMsg := fmt.Sprintf("%s (%d files): %s", p.config.CommitMsg, len(batch), strings.Join(fileList, ", "))

	// Commit all changes
	if err := exec.Command("git", "commit", "-m", commitMsg).Run(); err != nil {
		return fmt.Errorf("git commit failed: %w", err)
	}

	// Push
	if err := exec.Command("git", "push", "-u", p.config.GitRemote, p.config.Branch).Run(); err != nil {
		return fmt.Errorf("failed to push to %s: %w", p.config.Branch, err)
	}

	return nil
}

type ParsedDID struct {
	Original  string
	Host      string
	Project   string
	PathSegs  []string
	HostLower string
}

func parseDID(did string) (*ParsedDID, error) {
	if !strings.HasPrefix(did, "did:web:") {
		return nil, fmt.Errorf("not a did:web DID: %s", did)
	}

	parts := strings.Split(did, ":")
	if len(parts) < 4 {
		return nil, fmt.Errorf("DID missing project segment: %s", did)
	}

	parsed := &ParsedDID{
		Original:  did,
		Host:      parts[2],
		Project:   parts[3],
		PathSegs:  parts[4:],
		HostLower: strings.ToLower(parts[2]),
	}

	return parsed, nil
}

func (p *DIDProcessor) buildFetchURL(parsed *ParsedDID) string {
	urlPath := parsed.Project
	if len(parsed.PathSegs) > 0 {
		urlPath = urlPath + "/" + strings.Join(parsed.PathSegs, "/")
	}
	return fmt.Sprintf("%s/%s/did.json", p.config.ServerURL, urlPath)
}

func (p *DIDProcessor) fetchDIDDocument(url, host string) ([]byte, error) {
	client := &http.Client{}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Host = host
	req.Header.Set("Host", host)

	log.Printf("Making request to %s with Host header: %s", url, host)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	return io.ReadAll(resp.Body)
}

func (p *DIDProcessor) determineTargetFile(parsed *ParsedDID) string {
	cwd, _ := os.Getwd()
	trimmedSegs := make([]string, len(parsed.PathSegs))
	copy(trimmedSegs, parsed.PathSegs)

	for len(trimmedSegs) > 0 {
		lastDir := filepath.Base(cwd)
		if lastDir == trimmedSegs[0] {
			trimmedSegs = trimmedSegs[1:]
			cwd = filepath.Dir(cwd)
		} else {
			break
		}
	}

	var targetDir string
	if len(trimmedSegs) > 0 {
		targetDir = strings.Join(trimmedSegs, "/")
	} else {
		targetDir = "."
	}

	return filepath.Join(targetDir, "did.json")
}

func (p *DIDProcessor) saveDIDDocument(data []byte, targetFile string) error {
	dir := filepath.Dir(targetFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	var formattedData []byte
	var jsonObj interface{}
	if err := json.Unmarshal(data, &jsonObj); err == nil {
		if formatted, err := json.MarshalIndent(jsonObj, "", "  "); err == nil {
			formattedData = formatted
		} else {
			formattedData = data
		}
	} else {
		log.Println("Warning: invalid JSON, saving raw")
		formattedData = data
	}

	return os.WriteFile(targetFile, formattedData, 0644)
}

func (p *DIDProcessor) validateDIDDocumentID(targetFile string, parsed *ParsedDID) error {
	data, err := os.ReadFile(targetFile)
	if err != nil {
		return err
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("could not parse DID document for validation")
	}

	docID, ok := doc["id"].(string)
	if !ok || docID == "" {
		return fmt.Errorf("no 'id' field found in DID document")
	}

	expectedID := fmt.Sprintf("did:web:%s:%s", parsed.Host, parsed.Project)
	if len(parsed.PathSegs) > 0 {
		expectedID = expectedID + ":" + strings.Join(parsed.PathSegs, ":")
	}

	if docID != expectedID {
		return fmt.Errorf("DID doc id mismatch: got %s, expected %s", docID, expectedID)
	}

	return nil
}

func (p *DIDProcessor) checkGitRemote() error {
	cmd := exec.Command("git", "remote", "get-url", p.config.GitRemote)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("remote '%s' not found", p.config.GitRemote)
	}
	return nil
}

func (p *DIDProcessor) getRemoteURL() (string, error) {
	cmd := exec.Command("git", "remote", "get-url", p.config.GitRemote)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get remote URL: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

func (p *DIDProcessor) parseGitHubURL(remoteURL string) (user, repo string, err error) {
	// SSH form: git@github.com:User/Repo.git
	sshRegex := regexp.MustCompile(`^git@github\.com:([^/]+)/([^/]+)(\.git)?$`)
	if matches := sshRegex.FindStringSubmatch(remoteURL); len(matches) >= 3 {
		user = matches[1]
		repo = strings.TrimSuffix(matches[2], ".git")
		return user, repo, nil
	}

	// HTTPS form: https://github.com/User/Repo(.git)
	httpsRegex := regexp.MustCompile(`^https://github\.com/([^/]+)/([^/]+)(\.git)?$`)
	if matches := httpsRegex.FindStringSubmatch(remoteURL); len(matches) >= 3 {
		user = matches[1]
		repo = strings.TrimSuffix(matches[2], ".git")
		return user, repo, nil
	}

	return "", "", fmt.Errorf("remote is not a GitHub SSH/HTTPS URL: %s", remoteURL)
}

func checkoutOrCreateBranch(branch string) error {
	var out bytes.Buffer
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch := strings.TrimSpace(out.String())

	if currentBranch == branch {
		return nil
	}

	checkBranch := exec.Command("git", "rev-parse", "--verify", branch)
	if err := checkBranch.Run(); err != nil {
		if err := exec.Command("git", "checkout", "-b", branch).Run(); err != nil {
			return fmt.Errorf("failed to create branch %s: %w", branch, err)
		}
	} else {
		if err := exec.Command("git", "checkout", branch).Run(); err != nil {
			return fmt.Errorf("failed to checkout branch %s: %w", branch, err)
		}
	}

	return nil
}
