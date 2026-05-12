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
	ResourceType string    `json:"resourceType"`
	ChangeType   string    `json:"changeType"` // created, modified, deleted
	Field        string    `json:"field"`
	OldValue     string    `json:"oldValue"`
	NewValue     string    `json:"newValue"`
	Timestamp    time.Time `json:"timestamp"`
	Cost         float64   `json:"cost"`
	ChangedBy    string    `json:"changedBy"` // user who made the change
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

// Enhanced Reporting Types

type ResourceGroupCostReport struct {
	ResourceGroup    string  `json:"resourceGroup"`
	SubscriptionID   string  `json:"subscriptionId"`
	SubscriptionName string  `json:"subscriptionName"`
	CurrentMonthCost float64 `json:"currentMonthCost"`
	PreviousMonthCost float64 `json:"previousMonthCost"`
	CostChange       float64 `json:"costChange"`
	CostChangePercent float64 `json:"costChangePercent"`
	ResourceCount    int     `json:"resourceCount"`
	TopCostResources []ResourceCostSummary `json:"topCostResources"`
}

type ResourceCostSummary struct {
	ResourceID   string  `json:"resourceId"`
	ResourceName string  `json:"resourceName"`
	ResourceType string  `json:"resourceType"`
	MonthlyCost  float64 `json:"monthlyCost"`
	CostPercent  float64 `json:"costPercent"`
}

type DailyCostTrend struct {
	Date         string  `json:"date"`
	CurrentMonth float64 `json:"currentMonth"`
	PreviousMonth float64 `json:"previousMonth"`
	Change       float64 `json:"change"`
	ChangePercent float64 `json:"changePercent"`
}

type CostTrendReport struct {
	SubscriptionID    string           `json:"subscriptionId"`
	SubscriptionName  string           `json:"subscriptionName"`
	DailyTrends       []DailyCostTrend `json:"dailyTrends"`
	CurrentMonthTotal float64          `json:"currentMonthTotal"`
	PreviousMonthTotal float64         `json:"previousMonthTotal"`
	OverallChange     float64          `json:"overallChange"`
	OverallChangePercent float64       `json:"overallChangePercent"`
	ProjectedMonthEnd float64          `json:"projectedMonthEnd"`
}

type EnhancedReport struct {
	GeneratedAt           time.Time               `json:"generatedAt"`
	ReportPeriod          string                  `json:"reportPeriod"`
	ResourceGroupReports  []ResourceGroupCostReport `json:"resourceGroupReports"`
	CostTrends            []CostTrendReport       `json:"costTrends"`
	Summary               ReportSummary           `json:"summary"`
	TopChanges            []CostChangeItem        `json:"topChanges"`
}

type ReportSummary struct {
	TotalCurrentMonthCost  float64 `json:"totalCurrentMonthCost"`
	TotalPreviousMonthCost float64 `json:"totalPreviousMonthCost"`
	TotalChange            float64 `json:"totalChange"`
	TotalChangePercent     float64 `json:"totalChangePercent"`
	TotalResourceGroups    int     `json:"totalResourceGroups"`
	TotalResources         int     `json:"totalResources"`
	AvgCostPerResource     float64 `json:"avgCostPerResource"`
}

type CostChangeItem struct {
	ResourceGroup    string  `json:"resourceGroup"`
	ChangeType       string  `json:"changeType"` // increased, decreased, new
	CurrentCost      float64 `json:"currentCost"`
	PreviousCost     float64 `json:"previousCost"`
	ChangeAmount     float64 `json:"changeAmount"`
	ChangePercent    float64 `json:"changePercent"`
}
