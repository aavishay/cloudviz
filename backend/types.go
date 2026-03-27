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
	Cost         float64   `json:"cost"`
}

type MetricStats struct {
	Min  float64 `json:"min"`
	Max  float64 `json:"max"`
	Avg  float64 `json:"avg"`
	P95  float64 `json:"p95"`
	Unit string  `json:"unit"`
}

type MetricsSummary struct {
	Metrics map[string]MetricStats `json:"metrics"`
}

type Recommendation struct {
	Category         string  `json:"category"`   // rightsize, stop, schedule, migrate, delete, monitor
	Action           string  `json:"action"`
	EstimatedSavings float64 `json:"estimatedSavings"`
	SavingsPercent   float64 `json:"savingsPercent"`
	Rationale        string  `json:"rationale"`
	Priority         int     `json:"priority"` // 1=high, 2=medium, 3=low
}

type AIInsight struct {
	ResourceID      string            `json:"resourceId"`
	ResourceName    string            `json:"resourceName"`
	ResourceType    string            `json:"resourceType"`
	ResourceGroup   string            `json:"resourceGroup"`
	Location        string            `json:"location"`
	SubscriptionID  string            `json:"subscriptionId"`
	MonthlyCost     float64           `json:"monthlyCost"`
	Metrics         map[string][]float64 `json:"metrics"`         // raw time-series for charts
	MetricsSummary  MetricsSummary    `json:"metricsSummary"`   // computed stats
	Recommendations []Recommendation  `json:"recommendations"`
	Category        string            `json:"category"`
	ConfidenceScore float64           `json:"confidenceScore"`
	OllamaAvailable bool              `json:"ollamaAvailable"`
	Error           string            `json:"error,omitempty"`
}
