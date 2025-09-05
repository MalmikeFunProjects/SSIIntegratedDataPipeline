package veramo

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"data_synthesizer/models"
)

type CredentialData struct {
	DidIdentifier              models.DIDIdentifier
	DID                        string
	AuthorizationCredential    models.AuthorizationCredential
	AuthorizationCredentialJWT string
}

type IdentityInformation struct {
	Credentials map[string]CredentialData `json:"credentials"`
	Client      *VeramoClient
}

type didCreationResult struct {
	symbol string
	data   CredentialData
	err    error
}

func BootstrapDevice(vcClient *VeramoClient, kms string, provider string, symbols []string, didWebHost string, didWebProject string) (*IdentityInformation, error) {
	// 1. Create a DID
	credentialMap := make(map[string]CredentialData)

	// Channel to collect results from goroutines
	resultChan := make(chan didCreationResult, len(symbols))
	var wg sync.WaitGroup

	// Launch goroutines for concurrent DID creation
	for _, symbol := range symbols {
		wg.Add(1)
		go func(sym string) {
			defer wg.Done()

			var didResp []byte
			var err error
			if provider == "did:web" {
				didWebAlias := CreateDidWebAlias(didWebHost, didWebProject, sym)
				fmt.Println(didWebAlias)
				didResp, err = vcClient.CreateDID(didWebAlias, kms, provider)
			} else {
				alias := fmt.Sprintf("%s:%s", provider, sym)
				didResp, err = vcClient.CreateDID(alias, kms, provider)
			}

			if err != nil {
				resultChan <- didCreationResult{symbol: sym, err: fmt.Errorf("failed to create DID for %s: %w", sym, err)}
				return
			}

			var identityData models.AuthorizationResponse
			if err := json.Unmarshal(didResp, &identityData); err != nil {
				resultChan <- didCreationResult{symbol: sym, err: fmt.Errorf("failed to unmarshal response for %s: %w", sym, err)}
				return
			}

			log.Printf("✔ Created DID: %s for Symbol %s", identityData.DidIdentifier.Alias, sym)
			log.Printf("🔑 DID: %s", identityData.DidIdentifier.DID)
			log.Printf("🔑 Authorization: %s", identityData.AuthorizationCredentialJWT)

			credData := CredentialData{
				DidIdentifier:              identityData.DidIdentifier,
				DID:                        identityData.DidIdentifier.DID,
				AuthorizationCredential:    identityData.AuthorizationCredential,
				AuthorizationCredentialJWT: identityData.AuthorizationCredentialJWT,
			}

			resultChan <- didCreationResult{symbol: sym, data: credData, err: nil}
		}(symbol)
	}

	// Close the channel when all goroutines are done
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// Collect results
	for result := range resultChan {
		if result.err != nil {
			return nil, result.err
		}
		credentialMap[result.symbol] = result.data
	}

	return &IdentityInformation{
		Credentials: credentialMap,
		Client:      vcClient,
	}, nil
}

func (di *IdentityInformation) checkCredentials(symbol string) (*CredentialData, error) {
	if di == nil || di.Credentials == nil {
		return nil, fmt.Errorf("DeviceIdentity or Credentials is nil")
	}
	credential, exists := di.Credentials[symbol]
	if !exists {
		return nil, fmt.Errorf("no credentials found for symbol: %s", symbol)
	}
	return &credential, nil
}

// GetDIDSubject returns the DID string
func (di *IdentityInformation) GetDIDSubject(symbol string) string {
	credential, err := di.checkCredentials(symbol)
	if err != nil {
		log.Printf("❌ %v", err)
		return ""
	}
	if credential.DID == "" {
		log.Printf("❌ No DID document found for symbol: %s", symbol)
		return ""
	}

	return credential.DID
}

func (di *IdentityInformation) GetDidIdentifier(symbol string) (models.DIDIdentifier, error) {
	credential, err := di.checkCredentials(symbol)
	if err != nil {
		log.Printf("❌ %v", err)
		return models.DIDIdentifier{}, err
	}
	return credential.DidIdentifier, nil
}

func (di *IdentityInformation) GetAuthorizationCredential(symbol string) (models.AuthorizationCredential, error){
	credential, err := di.checkCredentials(symbol)
	if err != nil {
		log.Printf("❌ %v", err)
		return models.AuthorizationCredential{}, err
	}
	return credential.AuthorizationCredential, nil
}

func (di *IdentityInformation) GetAuthourizationCredentialJWT(symbol string) string {
	credential, err := di.checkCredentials(symbol)
	if err != nil {
		log.Printf("❌ %v", err)
		return ""
	}
	return credential.AuthorizationCredentialJWT
}
