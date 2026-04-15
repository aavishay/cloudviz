package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// Alert represents a budget/usage alert
type Alert struct {
	ID             int
	Name           string
	Type           string
	Threshold      float64
	Email          string
	WebhookURL     string
	Enabled        bool
	SubscriptionID string
	ResourceGroup  string
	Period         string
}

// WebhookPayload represents the JSON payload sent to webhook endpoints
type WebhookPayload struct {
	AlertID        string                 `json:"alertId"`
	AlertName      string                 `json:"alertName"`
	AlertType      string                 `json:"alertType"`
	SubscriptionID string                 `json:"subscriptionId"`
	ResourceGroup  string                 `json:"resourceGroup,omitempty"`
	CurrentCost    float64                `json:"currentCost"`
	Threshold      float64                `json:"threshold"`
	Percentage     float64                `json:"percentage"`
	Period         string                 `json:"period"`
	TriggeredAt    time.Time              `json:"triggeredAt"`
	Message        string                 `json:"message"`
	Severity       string                 `json:"severity"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

// WebhookDelivery tracks webhook delivery attempts
type WebhookDelivery struct {
	ID          int
	AlertID     int
	WebhookURL  string
	Payload     string
	StatusCode  int
	Response    string
	Error       string
	AttemptedAt time.Time
	RetryCount  int
}

// WebhookNotifier handles webhook notifications
type WebhookNotifier struct {
	db     *sql.DB
	client *http.Client
}

// NewWebhookNotifier creates a new webhook notifier
func NewWebhookNotifier(db *sql.DB) *WebhookNotifier {
	return &WebhookNotifier{
		db: db,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// LoadEnabledAlerts loads all enabled alerts from the database
func (wn *WebhookNotifier) LoadEnabledAlerts() ([]Alert, error) {
	rows, err := wn.db.Query(`
		SELECT id, name, type, threshold, email, webhook_url, enabled, subscription_id, resource_group, period
		FROM alerts
		WHERE enabled = 1 AND webhook_url != ''
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to query alerts: %w", err)
	}
	defer rows.Close()

	var alerts []Alert
	for rows.Next() {
		var alert Alert
		var enabled int
		var webhook sql.NullString
		err := rows.Scan(
			&alert.ID, &alert.Name, &alert.Type, &alert.Threshold, &alert.Email,
			&webhook, &enabled, &alert.SubscriptionID, &alert.ResourceGroup, &alert.Period,
		)
		if err != nil {
			log.Printf("Warning: failed to scan alert: %v", err)
			continue
		}
		alert.Enabled = enabled == 1
		if webhook.Valid {
			alert.WebhookURL = webhook.String
		}
		alerts = append(alerts, alert)
	}

	return alerts, nil
}

// GetCurrentCost calculates current cost for an alert's scope
func (wn *WebhookNotifier) GetCurrentCost(alert Alert) (float64, error) {
	var cost float64
	var query string
	var args []interface{}

	if alert.ResourceGroup != "" {
		// Resource group specific cost
		query = `
			SELECT COALESCE(SUM(cost), 0)
			FROM costs
			WHERE subscription_id = ? AND resource_group = ? AND period = 'current'
		`
		args = []interface{}{alert.SubscriptionID, alert.ResourceGroup}
	} else if alert.SubscriptionID != "" {
		// Subscription-wide cost
		query = `
			SELECT COALESCE(SUM(cost), 0)
			FROM costs
			WHERE subscription_id = ? AND period = 'current'
		`
		args = []interface{}{alert.SubscriptionID}
	} else {
		// Global cost (all subscriptions)
		query = `
			SELECT COALESCE(SUM(cost), 0)
			FROM costs
			WHERE period = 'current'
		`
	}

	err := wn.db.QueryRow(query, args...).Scan(&cost)
	if err != nil {
		return 0, fmt.Errorf("failed to query cost: %w", err)
	}

	return cost, nil
}

// SendWebhook sends a webhook notification
func (wn *WebhookNotifier) SendWebhook(alert Alert, currentCost float64) error {
	if alert.WebhookURL == "" {
		return nil
	}

	percentage := 0.0
	if alert.Threshold > 0 {
		percentage = (currentCost / alert.Threshold) * 100
	}

	// Determine severity
	severity := "info"
	if percentage >= 100 {
		severity = "critical"
	} else if percentage >= 90 {
		severity = "warning"
	} else if percentage >= 75 {
		severity = "info"
	}

	payload := WebhookPayload{
		AlertID:        fmt.Sprintf("%d", alert.ID),
		AlertName:      alert.Name,
		AlertType:      alert.Type,
		SubscriptionID: alert.SubscriptionID,
		ResourceGroup:  alert.ResourceGroup,
		CurrentCost:    currentCost,
		Threshold:      alert.Threshold,
		Percentage:     percentage,
		Period:         alert.Period,
		TriggeredAt:    time.Now().UTC(),
		Message:        fmt.Sprintf("%s: $%.2f of $%.2f (%.1f%%)", alert.Name, currentCost, alert.Threshold, percentage),
		Severity:       severity,
		Metadata: map[string]interface{}{
			"currency": "USD",
			"source":   "cloudviz",
		},
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	// Create request
	req, err := http.NewRequest("POST", alert.WebhookURL, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CloudViz-Webhook/1.0")
	req.Header.Set("X-CloudViz-Event", "budget.alert")
	req.Header.Set("X-CloudViz-Signature", "") // Could add HMAC signature here

	// Send with retries
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}

		resp, err := wn.client.Do(req)
		if err != nil {
			lastErr = err
			log.Printf("Webhook delivery attempt %d failed for alert %d: %v", attempt+1, alert.ID, err)
			continue
		}

		// Read response body
		buf := new(bytes.Buffer)
		buf.ReadFrom(resp.Body)
		resp.Body.Close()

		// Log delivery
		wn.logDelivery(alert.ID, alert.WebhookURL, string(jsonPayload), resp.StatusCode, buf.String(), "", attempt)

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Printf("Webhook delivered successfully for alert %d to %s", alert.ID, alert.WebhookURL)
			return nil
		}

		lastErr = fmt.Errorf("webhook returned status %d", resp.StatusCode)
		log.Printf("Webhook delivery attempt %d returned status %d for alert %d", attempt+1, resp.StatusCode, alert.ID)

		// Don't retry on 4xx errors (client errors)
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			break
		}
	}

	// Log final failure
	wn.logDelivery(alert.ID, alert.WebhookURL, string(jsonPayload), 0, "", lastErr.Error(), 2)
	return fmt.Errorf("webhook delivery failed after retries: %w", lastErr)
}

// logDelivery records a webhook delivery attempt
func (wn *WebhookNotifier) logDelivery(alertID int, webhookURL, payload string, statusCode int, response, errStr string, retryCount int) {
	// Truncate payload and response if too long
	if len(payload) > 10000 {
		payload = payload[:10000] + "..."
	}
	if len(response) > 2000 {
		response = response[:2000] + "..."
	}

	_, err := wn.db.Exec(`
		INSERT INTO webhook_deliveries (alert_id, webhook_url, payload, status_code, response, error, attempted_at, retry_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, alertID, webhookURL, payload, statusCode, response, errStr, time.Now().UTC(), retryCount)

	if err != nil {
		log.Printf("Warning: failed to log webhook delivery: %v", err)
	}
}

// CheckAndNotify checks all alerts and sends notifications for triggered ones
func (wn *WebhookNotifier) CheckAndNotify() error {
	alerts, err := wn.LoadEnabledAlerts()
	if err != nil {
		return err
	}

	for _, alert := range alerts {
		currentCost, err := wn.GetCurrentCost(alert)
		if err != nil {
			log.Printf("Error calculating cost for alert %d: %v", alert.ID, err)
			continue
		}

		// Check if threshold is breached
		if currentCost >= alert.Threshold {
			// Check if we already sent a notification recently (rate limiting)
			if wn.shouldSendNotification(alert.ID) {
				if err := wn.SendWebhook(alert, currentCost); err != nil {
					log.Printf("Error sending webhook for alert %d: %v", alert.ID, err)
				}
			}
		}
	}

	return nil
}

// shouldSendNotification checks if enough time has passed since last notification
func (wn *WebhookNotifier) shouldSendNotification(alertID int) bool {
	var lastSent sql.NullTime
	err := wn.db.QueryRow(`
		SELECT MAX(attempted_at)
		FROM webhook_deliveries
		WHERE alert_id = ? AND status_code >= 200 AND status_code < 300
	`, alertID).Scan(&lastSent)

	if err != nil || !lastSent.Valid {
		// No previous successful delivery, send now
		return true
	}

	// Rate limit: only send once per hour for the same alert
	return time.Since(lastSent.Time) > time.Hour
}

// CreateWebhookDeliveriesTable creates the table for tracking webhook deliveries
func CreateWebhookDeliveriesTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS webhook_deliveries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			alert_id INTEGER NOT NULL,
			webhook_url TEXT NOT NULL,
			payload TEXT,
			status_code INTEGER,
			response TEXT,
			error TEXT,
			attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			retry_count INTEGER DEFAULT 0,
			FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create webhook_deliveries table: %w", err)
	}

	// Create index for faster lookups
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_alert ON webhook_deliveries(alert_id)`)
	if err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_time ON webhook_deliveries(attempted_at)`)
	if err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	return nil
}
