package models

import (
	"time"

	"github.com/google/uuid"
)

type FinnhubTradeRaw struct {
	Trade_Id        string   `json:"id"`
	Trade_Condition []string `json:"c"`
	Price           float64  `json:"p"`
	Symbol          string   `json:"s"`
	Event_Timestamp int64    `json:"t"`
	Volume          float64  `json:"v"`
}

type FinnhubTrade struct {
	Trade_Id        string
	Trade_Condition []string
	Price           float64
	Symbol          string
	Event_Timestamp int64
	Volume          float64
}

func (t *FinnhubTradeRaw) EnsureDefaults() {
	if t.Trade_Id == "" {
		t.Trade_Id = uuid.NewString()
	}
	if t.Trade_Condition == nil {
		t.Trade_Condition = []string{}
	}
}

// TradeMessage represents the incoming WebSocket message structure
type TradeMessage struct {
	Data []FinnhubTradeRaw `json:"data"`
	Type string            `json:"type"`
}

// SubscribeMessage represents the subscription message format
type SubscribeMessage struct {
	Type   string `json:"type"`
	Symbol string `json:"symbol"`
}

// TradeHandler defines the interface for handling trade data
type TradeHandler interface {
	HandleTrade(trade FinnhubTrade, startTimestamp time.Time) error
	HandleBatch(trades []FinnhubTrade, startTimestamp time.Time) error
	Close() error
}

// Root object
type AuthorizationResponse struct {
	AuthorizationCredential    AuthorizationCredential `json:"authorizationCredential"`
	AuthorizationCredentialJWT string                  `json:"authorizationCredentialJWT"`
	DidIdentifier              DIDIdentifier           `json:"didIdentifier"`
}

// ----------------------------
// Authorization Credential
// ----------------------------
type AuthorizationCredential struct {
	CredentialSubject CredentialSubject `json:"credentialSubject"`
	Issuer            Issuer            `json:"issuer"`
	Type              []string          `json:"type"`
	Context           []string          `json:"@context"`
	IssuanceDate      time.Time         `json:"issuanceDate"`
	ExpirationDate    time.Time         `json:"expirationDate"`
	Proof             Proof             `json:"proof"`
}

type CredentialSubject struct {
	AuthorizedDID string    `json:"authorizedDID"`
	Permissions   []string  `json:"permissions"`
	Scope         string    `json:"scope"`
	CNF           CNF       `json:"cnf"`
	GrantedAt     time.Time `json:"grantedAt"`
	TTLms         int64     `json:"ttlMs"`
	ID            string    `json:"id"`
}

type CNF struct {
	JWT string `json:"jwt"`
}

type Issuer struct {
	ID string `json:"id"`
}

type Proof struct {
	Type string `json:"type"`
	JWT  string `json:"jwt"`
}

// ----------------------------
// DID Identifier
// ----------------------------
type DIDIdentifier struct {
	DID             string `json:"did"`
	ControllerKeyID string `json:"controllerKeyId"`
	Keys            []Key  `json:"keys"`
	Services        []any  `json:"services"`
	Provider        string `json:"provider"`
	Alias           string `json:"alias"`
}

type Key struct {
	Type         string  `json:"type"`
	KID          string  `json:"kid"`
	PublicKeyHex string  `json:"publicKeyHex"`
	Meta         KeyMeta `json:"meta"`
	KMS          string  `json:"kms"`
}

type KeyMeta struct {
	Algorithms []string `json:"algorithms"`
}
