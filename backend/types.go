package main

import "time"

type AzureResource struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Type           string            `json:"type"`
	Location       string            `json:"location"`
	SubscriptionID string            `json:"subscriptionId"`
	ResourceGroup  string            `json:"resourceGroup"`
	Status         string            `json:"status"`
	Tags           map[string]string `json:"tags"`
	Cost           float64           `json:"cost"`
	Optimization   string            `json:"optimization,omitempty"`
	Score          int               `json:"score"`
	IsOrphaned     bool              `json:"isOrphaned"`
}

type ResourceChange struct {
	ResourceID   string    `json:"resourceId"`
	ResourceName string    `json:"resourceName"`
	ChangeType   string    `json:"changeType"` // created, modified, deleted
	Field        string    `json:"field"`
	OldValue     string    `json:"oldValue"`
	NewValue     string    `json:"newValue"`
	Timestamp    time.Time `json:"timestamp"`
}
