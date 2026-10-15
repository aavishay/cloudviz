package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestIsDisallowedWebhookIP(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::", "100.64.0.1", "fd00::1", "224.0.0.1", "::ffff:10.0.0.1"} {
		assert.True(t, isDisallowedWebhookIP(net.ParseIP(ip)), ip)
	}
	for _, ip := range []string{"8.8.8.8", "52.168.1.1", "2606:4700::1111"} {
		assert.False(t, isDisallowedWebhookIP(net.ParseIP(ip)), ip)
	}
	assert.Error(t, validateWebhookURL("http://0.0.0.0:8080/x"))
	assert.Error(t, validateWebhookURL("http://[::]:8080/x"))
	assert.Error(t, validateWebhookURL("http://169.254.169.254/latest/meta-data"))
}

func TestWebhookClientRefusesInternalAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer srv.Close()
	// A hostname that resolves to loopback must be blocked at connect time, not just
	// literal IPs at validation time.
	url := strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)
	_, err := newWebhookClient().Post(url, "application/json", strings.NewReader("{}"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestSendWebhookRetriesWithFullBody(t *testing.T) {
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		if len(bodies) < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	testCache, cleanup := setupTestDB(t)
	defer cleanup()
	db := testCache.db
	require.NoError(t, CreateWebhookDeliveriesTable(db))
	// The test server is on loopback, which the real client refuses; use a plain one.
	wn := &WebhookNotifier{db: db, client: srv.Client()}

	// validateWebhookURL rejects loopback, so call the delivery path directly.
	alert := Alert{ID: 1, Name: "test", Threshold: 100, WebhookURL: srv.URL}
	require.NoError(t, wn.deliverWebhook(alert, 50))
	require.Len(t, bodies, 2)
	assert.NotEmpty(t, bodies[1], "the retry carries the payload")
	assert.Equal(t, bodies[0], bodies[1])
}

func TestShouldSendNotificationRateLimits(t *testing.T) {
	testCache, cleanup := setupTestDB(t)
	defer cleanup()
	require.NoError(t, CreateWebhookDeliveriesTable(testCache.db))
	wn := &WebhookNotifier{db: testCache.db}

	assert.True(t, wn.shouldSendNotification(7), "first notification is sent")
	wn.logDelivery(7, "https://example.com", "{}", 500, "", "boom", 0)
	assert.False(t, wn.shouldSendNotification(7), "a recent failed attempt also waits an hour")
	_, err := testCache.db.Exec("UPDATE webhook_deliveries SET attempted_at = datetime('now', '-2 hours')")
	require.NoError(t, err)
	assert.True(t, wn.shouldSendNotification(7), "after an hour it is sent again")
}
