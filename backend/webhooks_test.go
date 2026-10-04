package main

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// Test Alert struct
func TestAlert_Struct(t *testing.T) {
	alert := Alert{
		ID:             1,
		Name:           "Test Alert",
		Type:           "budget",
		Threshold:      100.0,
		Email:          "test@example.com",
		WebhookURL:     "https://example.com/webhook",
		Enabled:        true,
		SubscriptionID: "sub-123",
		ResourceGroup:  "rg-test",
		Period:         "monthly",
	}

	assert.Equal(t, 1, alert.ID)
	assert.Equal(t, "Test Alert", alert.Name)
	assert.Equal(t, "budget", alert.Type)
	assert.Equal(t, 100.0, alert.Threshold)
	assert.Equal(t, "sub-123", alert.SubscriptionID)
}

// Test WebhookPayload struct
func TestWebhookPayload_Struct(t *testing.T) {
	payload := WebhookPayload{
		AlertID:        "1",
		AlertName:      "Budget Alert",
		AlertType:      "budget",
		SubscriptionID: "sub-123",
		CurrentCost:    150.0,
		Threshold:      100.0,
		Percentage:     150.0,
		Period:         "monthly",
		Severity:       "critical",
		Message:        "Budget exceeded",
		Metadata:       map[string]interface{}{"key": "value"},
	}

	assert.Equal(t, "Budget Alert", payload.AlertName)
	assert.Equal(t, 150.0, payload.CurrentCost)
	assert.Equal(t, "critical", payload.Severity)
}

// Test WebhookDelivery struct
func TestWebhookDelivery_Struct(t *testing.T) {
	delivery := WebhookDelivery{
		ID:          1,
		AlertID:     2,
		WebhookURL:  "https://example.com/webhook",
		Payload:     `{"alertId":"1"}`,
		StatusCode:  200,
		Response:    "OK",
		RetryCount:  0,
		AttemptedAt: time.Now(),
	}

	assert.Equal(t, 1, delivery.ID)
	assert.Equal(t, 2, delivery.AlertID)
	assert.Equal(t, 200, delivery.StatusCode)
}

// Test validateWebhookURL function
func TestValidateWebhookURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		env     string
		wantErr bool
	}{
		{
			name:    "Valid HTTPS URL",
			url:     "https://example.com/webhook",
			wantErr: false,
		},
		{
			name:    "Valid HTTP URL in development",
			url:     "http://example.com/webhook",
			env:     "development",
			wantErr: false,
		},
		{
			name:    "HTTP URL in production fails",
			url:     "http://example.com/webhook",
			env:     "production",
			wantErr: true,
		},
		{
			name:    "Localhost blocked",
			url:     "http://localhost:8080/webhook",
			wantErr: true,
		},
		{
			name:    "127.0.0.1 blocked",
			url:     "http://127.0.0.1:8080/webhook",
			wantErr: true,
		},
		{
			name:    "Private IP blocked",
			url:     "http://192.168.1.1/webhook",
			wantErr: true,
		},
		{
			name:    "10.x.x.x blocked",
			url:     "http://10.0.0.1/webhook",
			wantErr: true,
		},
		{
			name:    "Invalid scheme blocked",
			url:     "ftp://example.com/webhook",
			wantErr: true,
		},
		{
			name:    "Invalid URL",
			url:     "://invalid-url",
			wantErr: true,
		},
		{
			name:    ".internal domain blocked",
			url:     "https://service.internal/webhook",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.env != "" {
				t.Setenv("ENV", tt.env)
			}
			err := validateWebhookURL(tt.url)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// Test isPrivateHost function
func TestIsPrivateHost(t *testing.T) {
	tests := []struct {
		host     string
		expected bool
	}{
		{"localhost", true},
		{"127.0.0.1", true},
		{"::1", true},
		{"192.168.1.1", true},
		{"10.0.0.1", true},
		{"172.16.0.1", true},
		{"169.254.1.1", true}, // Link-local
		{"example.com", false},
		{"api.example.com", false},
		{"localhost.local", true},
		{"service.cluster.local", true},
		{"service.internal", true},
		{"192.169.1.1", false}, // Just outside private range
		{"11.0.0.1", false},
	}

	for _, tt := range tests {
		t.Run(tt.host, func(t *testing.T) {
			result := isPrivateHost(tt.host)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// Test NewWebhookNotifier
func TestNewWebhookNotifier(t *testing.T) {
	// This test verifies the struct creation
	// In a real test, we'd use a mock database
	notifier := &WebhookNotifier{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	assert.NotNil(t, notifier)
	assert.NotNil(t, notifier.client)
	assert.Equal(t, 30*time.Second, notifier.client.Timeout)
}

// Test WebhookPayload with different severity levels
func TestWebhookPayload_SeverityLevels(t *testing.T) {
	severities := []string{"info", "warning", "critical"}

	for _, severity := range severities {
		t.Run(severity, func(t *testing.T) {
			payload := WebhookPayload{
				AlertID:   "1",
				AlertName: "Test",
				Severity:  severity,
			}
			assert.Equal(t, severity, payload.Severity)
		})
	}
}

// Test Alert with zero values
func TestAlert_ZeroValues(t *testing.T) {
	alert := Alert{}

	assert.Equal(t, 0, alert.ID)
	assert.Equal(t, "", alert.Name)
	assert.Equal(t, "", alert.WebhookURL)
	assert.False(t, alert.Enabled)
	assert.Equal(t, 0.0, alert.Threshold)
}

// Test WebhookDelivery with error
func TestWebhookDelivery_WithError(t *testing.T) {
	delivery := WebhookDelivery{
		ID:         1,
		Error:      "Connection refused",
		StatusCode: 0,
	}

	assert.Equal(t, "Connection refused", delivery.Error)
	assert.Equal(t, 0, delivery.StatusCode)
}
