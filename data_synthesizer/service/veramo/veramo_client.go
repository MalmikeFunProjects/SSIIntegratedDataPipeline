package veramo

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"data_synthesizer/config"
	"data_synthesizer/service/metrics"
)

type VeramoClient struct {
	BaseURL string
	Token   string
}

func NewClient(config *config.Config) *VeramoClient {
	return &VeramoClient{
		BaseURL: config.VeramoURL,
		Token:   config.VeramoToken,
	}
}

func (vc *VeramoClient) doRequest(method, endpoint string, body interface{}, extraAuthentication string) ([]byte, error) {
	timer := prometheus.NewTimer(metrics.VeramoAPIDuration.WithLabelValues(endpoint, method, "unknown"))
	defer timer.ObserveDuration()

	var buf io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			metrics.VeramoAPIRequestErrors.WithLabelValues(method, endpoint).Inc()
			return nil, err
		}
		buf = bytes.NewBuffer(jsonData)
	}

	req, err := http.NewRequest(method, vc.BaseURL+endpoint, buf)
	if err != nil {
		metrics.VeramoAPIRequestErrors.WithLabelValues(method, endpoint).Inc()
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+vc.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json; charset=utf-8")
	if extraAuthentication != "" {
		req.Header.Set("x-authorization", "Bearer "+extraAuthentication)
	}

	resp, err := http.DefaultClient.Do(req)

	if err != nil {
		metrics.VeramoAPIRequestErrors.WithLabelValues(method, endpoint).Inc()
		return nil, err
	}
	defer resp.Body.Close()

	statusCode := fmt.Sprintf("%d", resp.StatusCode)
	metrics.VeramoAPIRequestsTotal.WithLabelValues(endpoint, method, statusCode).Inc()

	// Update timer with actual status code
	timer = prometheus.NewTimer(metrics.VeramoAPIDuration.WithLabelValues(endpoint, method, statusCode))
	defer timer.ObserveDuration()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		metrics.VeramoAPIRequestErrors.WithLabelValues(method, endpoint).Inc()
		return nil, err
	}

	if resp.StatusCode >= 400 {
		metrics.VeramoAPIRequestErrors.WithLabelValues(method, endpoint).Inc()
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (vc *VeramoClient) CreateDID(alias string, kms string, provider string) ([]byte, error) {
	return vc.doRequest("POST", "/agent/didManagerCreateWithAccessRights", map[string]interface{}{
		"alias":    alias,
		"provider": provider,
		"kms":      kms,
	}, "")
}

func (vc *VeramoClient) IssueVC(issuer string, subjectID string, claims map[string]interface{}, data_id string, authorizationCredentialJWT string) ([]byte, error) {
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	vc_id := fmt.Sprintf("vc:%s:%s", data_id, uuid.NewString())
	credential := map[string]interface{}{
		"credential": map[string]interface{}{
			"@context": []string{
				"https://www.w3.org/2018/credentials/v1",
			},
			"id": vc_id,
			"type": []string{
				"VerifiableCredential",
			},
			"issuer": map[string]interface{}{
				"id": issuer,
			},
			"issuanceDate": now,
			"credentialSubject": map[string]interface{}{
				"id":     subjectID,
				"claims": claims,
			},
		},
		"proofFormat": "jwt",
	}
	return vc.doRequest("POST", "/agent/createVerifiableCredential", credential, authorizationCredentialJWT)
}
