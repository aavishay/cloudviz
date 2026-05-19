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
	CreatedBy      string            `json:"createdBy,omitempty"`      // Email or username of creator
	CreatedByType  string            `json:"createdByType,omitempty"`  // "user", "service_principal", "managed_identity"
	CreatedAt      time.Time         `json:"createdAt,omitempty"`      // Creation timestamp
	LastModifiedBy string            `json:"lastModifiedBy,omitempty"` // Last modifier email/username
	LastModifiedAt time.Time         `json:"lastModifiedAt,omitempty"`
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
	ResourceGroup         string                 `json:"resourceGroup"`
	SubscriptionID        string                 `json:"subscriptionId"`
	SubscriptionName      string                 `json:"subscriptionName"`
	CurrentMonthCost      float64                `json:"currentMonthCost"`
	PreviousMonthCost     float64                `json:"previousMonthCost"`
	CostChange            float64                `json:"costChange"`
	CostChangePercent     float64                `json:"costChangePercent"`
	ResourceCount         int                    `json:"resourceCount"`
	PreviousResourceCount int                    `json:"previousResourceCount"`
	ResourceCountChange   int                    `json:"resourceCountChange"`
	TopCostResources      []ResourceCostSummary  `json:"topCostResources"`
	CostByDay             []DayCost              `json:"costByDay"`
	Tags                  map[string]string      `json:"tags"`
}

type DayCost struct {
	Date     string  `json:"date"`
	Cost     float64 `json:"cost"`
	Resource int     `json:"resourceCount"`
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
	GeneratedAt               time.Time                    `json:"generatedAt"`
	ReportPeriod              string                       `json:"reportPeriod"`
	ResourceGroupReports      []ResourceGroupCostReport    `json:"resourceGroupReports"`
	CostTrends                []CostTrendReport            `json:"costTrends"`
	Summary                   ReportSummary                `json:"summary"`
	TopChanges                []CostChangeItem             `json:"topChanges"`
	CostAnomalies             []CostAnomaly                `json:"costAnomalies"`
	ResourceTypeBreakdown     []ResourceTypeBreakdown      `json:"resourceTypeBreakdown"`
	SubscriptionComparisons   []SubscriptionComparison       `json:"subscriptionComparisons"`
	CostDistribution          CostDistribution             `json:"costDistribution"`
	HistoricalTrends          []HistoricalTrend            `json:"historicalTrends"`
	Forecast                  CostForecast                 `json:"forecast"`
	ResourceEfficiency        []ResourceEfficiency         `json:"resourceEfficiency"`
	Sparklines                []SparklineData              `json:"sparklines"`
	SavingsRecommendations    []CostSavingsRecommendation  `json:"savingsRecommendations"`
	MonthlyHeatmaps           []MonthlyHeatmap             `json:"monthlyHeatmaps"`
	DetailedChanges           []DetailedChange             `json:"detailedChanges"`
	TagAllocations            []TagCostAllocation          `json:"tagAllocations"`
	Benchmarks                []BenchmarkComparison        `json:"benchmarks"`
	WeeklySummaries           []WeeklySummary              `json:"weeklySummaries"`
	ExportMetadata            ExportOptions                `json:"exportMetadata"`
	ExecutiveSummary          ExecutiveSummary             `json:"executiveSummary"`
	CostAlerts                []CostAlert                  `json:"costAlerts"`
	ResourceLifecycles        []ResourceLifecycle          `json:"resourceLifecycles"`
	DepartmentRollups         []DepartmentRollup           `json:"departmentRollups"`
	CostVelocity              []CostVelocity               `json:"costVelocity"`
	ServiceBreakdowns         []ServiceLevelBreakdown      `json:"serviceBreakdowns"`
	GeographicDistribution    []GeographicDistribution     `json:"geographicDistribution"`
	UsageEfficiencyMetrics    []UsageEfficiencyMetrics     `json:"usageEfficiencyMetrics"`
	RGChangeTimelines         []ResourceGroupChangeTimeline `json:"rgChangeTimelines"`
	BudgetTracking            BudgetTracking               `json:"budgetTracking"`
	ResourceDrift             []ResourceDrift              `json:"resourceDrift"`
	MultiMonthTrends          []MonthlyTrend               `json:"multiMonthTrends"`
	CostAttribution           []CostAttribution            `json:"costAttribution"`
	CostCorrelations          []CostCorrelation            `json:"costCorrelations"`
	AnomalyPatterns           []AnomalyPattern             `json:"anomalyPatterns"`
	ComparisonMatrices        ComparisonMatrices           `json:"comparisonMatrices"`
	DailyCostHeatmaps         []DailyCostHeatmap           `json:"dailyCostHeatmaps"`
	RGScorecards              []ResourceGroupScorecard     `json:"rgScorecards"`
	TrendLineData             []TrendLinePoint             `json:"trendLineData"`
	CostScenarios             []CostScenario               `json:"costScenarios"`
	ExportData                ExportDataBundle             `json:"exportData"`
	ColorIndicators           ColorIndicators              `json:"colorIndicators"`
	DrillDownData             []DrillDownLevel           `json:"drillDownData"`
	PDFSummary                PDFReportSummary           `json:"pdfSummary"`
	NotificationTriggers      []NotificationTrigger      `json:"notificationTriggers"`
	HistoricalSnapshots       []HistoricalSnapshot       `json:"historicalSnapshots"`
	ChartConfig               ChartConfiguration         `json:"chartConfig"`
}

type CostDistribution struct {
	ByService     []DistributionItem `json:"byService"`
	ByLocation    []DistributionItem `json:"byLocation"`
	ByTag         []DistributionItem `json:"byTag"`
}

type DistributionItem struct {
	Name       string  `json:"name"`
	Cost       float64 `json:"cost"`
	Percentage float64 `json:"percentage"`
	Count      int     `json:"count"`
}

// HistoricalTrend represents cost data over a specific time period
type HistoricalTrend struct {
	Period          string    `json:"period"` // "7d", "30d", "90d"
	StartDate       string    `json:"startDate"`
	EndDate         string    `json:"endDate"`
	TotalCost       float64   `json:"totalCost"`
	AverageDailyCost  float64  `json:"averageDailyCost"`
	PeakDayCost     float64   `json:"peakDayCost"`
	LowestDayCost   float64   `json:"lowestDayCost"`
	DailyData       []DayCost `json:"dailyData"`
	GrowthRate      float64   `json:"growthRate"`
}

// CostForecast represents predicted future costs
type CostForecast struct {
	CurrentMonthProjected  float64            `json:"currentMonthProjected"`
	NextMonthForecast      float64            `json:"nextMonthForecast"`
	ThreeMonthForecast     float64            `json:"threeMonthForecast"`
	ConfidenceInterval     ForecastConfidence `json:"confidenceInterval"`
	TrendDirection         string             `json:"trendDirection"` // increasing, decreasing, stable
	SeasonalityDetected    bool               `json:"seasonalityDetected"`
}

type ForecastConfidence struct {
	Lower float64 `json:"lower"`
	Upper float64 `json:"upper"`
}

// ResourceEfficiency represents efficiency scoring for resources
type ResourceEfficiency struct {
	ResourceGroup      string                `json:"resourceGroup"`
	OverallScore       int                   `json:"overallScore"` // 0-100
	UtilizationScore   int                   `json:"utilizationScore"`
	CostEfficiency     int                   `json:"costEfficiency"`
	ResourceCount      int                   `json:"resourceCount"`
	InefficientResources []InefficientResource `json:"inefficientResources"`
	Recommendations    []string              `json:"recommendations"`
}

type InefficientResource struct {
	ResourceID   string  `json:"resourceId"`
	ResourceName string  `json:"resourceName"`
	ResourceType string  `json:"resourceType"`
	Score        int     `json:"score"`
	WastedCost   float64 `json:"wastedCost"`
	Reason       string  `json:"reason"`
}

// SparklineData represents mini chart data for inline visualizations
type SparklineData struct {
	Label   string    `json:"label"`
	Values  []float64 `json:"values"`
	Color   string    `json:"color"`
	Min     float64   `json:"min"`
	Max     float64   `json:"max"`
	Average float64   `json:"average"`
}

// TagCostAllocation represents cost breakdown by tags
type TagCostAllocation struct {
	TagKey        string          `json:"tagKey"`
	TagValues     []TagValueCost  `json:"tagValues"`
	TotalCost     float64         `json:"totalCost"`
	ResourceCount int             `json:"resourceCount"`
}

type TagValueCost struct {
	Value       string  `json:"value"`
	Cost        float64 `json:"cost"`
	Percentage  float64 `json:"percentage"`
	Count       int     `json:"count"`
}

// TagComplianceReport provides comprehensive tag compliance analysis
type TagComplianceReport struct {
	GeneratedAt          time.Time                 `json:"generatedAt"`
	TotalResources       int                       `json:"totalResources"`
	RequiredTags         []string                  `json:"requiredTags"`
	OverallCompliance    float64                   `json:"overallCompliance"` // 0-100%
	TagBreakdown         []TagComplianceDetail     `json:"tagBreakdown"`
	NonCompliantResources []NonCompliantResource   `json:"nonCompliantResources"`
	CompliantResources   int                       `json:"compliantResources"`
	ComplianceByRG       []RGTagCompliance         `json:"complianceByRG"`
	ComplianceByType     []TypeTagCompliance       `json:"complianceByType"`
}

type TagComplianceDetail struct {
	TagName           string  `json:"tagName"`
	CompliantCount    int     `json:"compliantCount"`
	NonCompliantCount int     `json:"nonCompliantCount"`
	ComplianceRate    float64 `json:"complianceRate"` // 0-100%
	PercentageOfTotal float64 `json:"percentageOfTotal"`
}

type NonCompliantResource struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Type           string            `json:"type"`
	ResourceGroup  string            `json:"resourceGroup"`
	SubscriptionID string            `json:"subscriptionId"`
	MissingTags    []string          `json:"missingTags"`
	PresentTags    map[string]string `json:"presentTags"`
	Cost           float64           `json:"cost"`
}

type RGTagCompliance struct {
	ResourceGroup     string  `json:"resourceGroup"`
	TotalResources    int     `json:"totalResources"`
	CompliantCount    int     `json:"compliantCount"`
	ComplianceRate    float64 `json:"complianceRate"`
}

type TypeTagCompliance struct {
	ResourceType      string  `json:"resourceType"`
	TotalResources    int     `json:"totalResources"`
	CompliantCount    int     `json:"compliantCount"`
	ComplianceRate    float64 `json:"complianceRate"`
}

// BenchmarkComparison compares costs against benchmarks
type BenchmarkComparison struct {
	Category          string  `json:"category"`
	CurrentCost       float64 `json:"currentCost"`
	BenchmarkCost     float64 `json:"benchmarkCost"`
	Difference        float64 `json:"difference"`
	DifferencePercent float64 `json:"differencePercent"`
	Status            string  `json:"status"` // above, below, at_target
	Recommendation    string  `json:"recommendation"`
}

// WeeklySummary provides weekly cost summaries
type WeeklySummary struct {
	WeekNumber        int       `json:"weekNumber"`
	WeekStart         string    `json:"weekStart"`
	WeekEnd           string    `json:"weekEnd"`
	TotalCost         float64   `json:"totalCost"`
	AverageDailyCost  float64   `json:"averageDailyCost"`
	HighestDay        DayCost   `json:"highestDay"`
	LowestDay         DayCost   `json:"lowestDay"`
	ChangeFromLastWeek float64  `json:"changeFromLastWeek"`
	ChangePercent     float64   `json:"changePercent"`
}

// ExportOptions for different report formats
type ExportOptions struct {
	Format         string   `json:"format"` // csv, json, pdf
	IncludeRawData bool     `json:"includeRawData"`
	DateRange      string   `json:"dateRange"`
	Fields         []string `json:"fields"`
}

// ExecutiveSummary provides high-level metrics for management
type ExecutiveSummary struct {
	TotalMonthlySpend      float64                `json:"totalMonthlySpend"`
	BudgetUtilization      float64                `json:"budgetUtilization"`
	CostPerEmployee        float64                `json:"costPerEmployee"`
	TopCostDrivers         []CostDriver           `json:"topCostDrivers"`
	RiskAreas              []RiskArea             `json:"riskAreas"`
	Achievements           []Achievement          `json:"achievements"`
	MonthOverMonthChange   float64                `json:"monthOverMonthChange"`
	ProjectedAnnualSpend   float64                `json:"projectedAnnualSpend"`
}

type CostDriver struct {
	Name           string  `json:"name"`
	Cost           float64 `json:"cost"`
	Percentage     float64 `json:"percentage"`
	Trend          string  `json:"trend"` // up, down, stable
	Impact         string  `json:"impact"` // high, medium, low
}

type RiskArea struct {
	Category        string  `json:"category"`
	Severity        string  `json:"severity"` // critical, high, medium, low
	Description     string  `json:"description"`
	PotentialImpact float64 `json:"potentialImpact"`
	Mitigation      string  `json:"mitigation"`
}

type Achievement struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Date        string `json:"date"`
	Impact      string `json:"impact"`
}

// CostAlert represents threshold alerts
type CostAlert struct {
	AlertID       string    `json:"alertId"`
	Type          string    `json:"type"` // budget_threshold, anomaly, spike
	Severity      string    `json:"severity"`
	ResourceGroup string    `json:"resourceGroup"`
	Threshold     float64   `json:"threshold"`
	ActualValue   float64   `json:"actualValue"`
	Percentage    float64   `json:"percentage"`
	TriggeredAt   time.Time `json:"triggeredAt"`
	Status        string    `json:"status"` // active, acknowledged, resolved
	Message       string    `json:"message"`
}

// ResourceLifecycle tracks resource lifecycle events
type ResourceLifecycle struct {
	ResourceID      string               `json:"resourceId"`
	ResourceName    string               `json:"resourceName"`
	ResourceType    string               `json:"resourceType"`
	ResourceGroup   string               `json:"resourceGroup"`
	CurrentState    string               `json:"currentState"` // active, deleted, modified
	CreatedAt       time.Time            `json:"createdAt"`
	ModifiedAt      time.Time            `json:"modifiedAt"`
	DeletedAt       *time.Time           `json:"deletedAt,omitempty"`
	AgeDays         int                  `json:"ageDays"`
	CostHistory     []LifecycleCostPoint `json:"costHistory"`
	StateTransitions []StateTransition    `json:"stateTransitions"`
}

type LifecycleCostPoint struct {
	Date  string  `json:"date"`
	Cost  float64 `json:"cost"`
	State string  `json:"state"`
}

type StateTransition struct {
	FromState string    `json:"fromState"`
	ToState   string    `json:"toState"`
	Timestamp time.Time `json:"timestamp"`
	Reason    string    `json:"reason"`
}

// DepartmentRollup aggregates costs by department/team
type DepartmentRollup struct {
	DepartmentName    string             `json:"departmentName"`
	Manager           string             `json:"manager"`
	TotalCost         float64            `json:"totalCost"`
	Budget            float64            `json:"budget"`
	BudgetUtilization float64            `json:"budgetUtilization"`
	ResourceGroups    []string           `json:"resourceGroups"`
	ResourceCount     int                `json:"resourceCount"`
	TeamMembers       []TeamMember       `json:"teamMembers"`
	TopServices       []ServiceCost      `json:"topServices"`
}

type TeamMember struct {
	Name        string  `json:"name"`
	Role        string  `json:"role"`
	Resources   int     `json:"resources"`
	Cost        float64 `json:"cost"`
}

type ServiceCost struct {
	ServiceName string  `json:"serviceName"`
	Cost        float64 `json:"cost"`
	Percentage  float64 `json:"percentage"`
}

// CostSavingsRecommendation provides actionable cost optimization recommendations
type CostSavingsRecommendation struct {
	ResourceGroup     string  `json:"resourceGroup"`
	ResourceType      string  `json:"resourceType"`
	Recommendation    string  `json:"recommendation"`
	CurrentCost       float64 `json:"currentCost"`
	ProjectedSavings  float64 `json:"projectedSavings"`
	SavingsPercentage float64 `json:"savingsPercentage"`
	ROI               float64 `json:"roi"` // Return on Investment ratio
	PaybackPeriodDays int     `json:"paybackPeriodDays"`
	Difficulty        string  `json:"difficulty"` // easy, medium, hard
	Impact            string  `json:"impact"`     // low, medium, high
	ActionSteps       []string `json:"actionSteps"`
}

// MonthlyHeatmap represents a heatmap of costs across days and resource groups
type MonthlyHeatmap struct {
	Month       string          `json:"month"`
	Year        int             `json:"year"`
	DaysInMonth int             `json:"daysInMonth"`
	Cells       []HeatmapCell   `json:"cells"`
	MinCost     float64         `json:"minCost"`
	MaxCost     float64         `json:"maxCost"`
}

type HeatmapCell struct {
	Day           int     `json:"day"`
	ResourceGroup string  `json:"resourceGroup"`
	Cost          float64 `json:"cost"`
	Color         string  `json:"color"` // CSS color based on intensity
	Intensity     float64 `json:"intensity"` // 0.0 to 1.0
}

// DetailedChange provides comprehensive change information
type DetailedChange struct {
	ChangeID        string              `json:"changeId"`
	Timestamp       time.Time           `json:"timestamp"`
	ResourceGroup   string              `json:"resourceGroup"`
	ResourceType    string              `json:"resourceType"`
	ResourceName    string              `json:"resourceName"`
	ChangeType      string              `json:"changeType"` // created, modified, deleted
	FieldChanged    string              `json:"fieldChanged"`
	Before          ChangeState         `json:"before"`
	After           ChangeState         `json:"after"`
	CostImpact      float64             `json:"costImpact"`
	ChangedBy       string              `json:"changedBy"`
	ChangeReason    string              `json:"changeReason"`
	RelatedChanges  []string            `json:"relatedChanges"`
	DiffIndicators  []DiffIndicator     `json:"diffIndicators"`
}

type ChangeState struct {
	Cost    float64               `json:"cost"`
	State   string                `json:"state"`
	Tags    map[string]string     `json:"tags"`
	Sku     string                `json:"sku"`
	Tier    string                `json:"tier"`
}

type DiffIndicator struct {
	Field      string `json:"field"`
	OldValue   string `json:"oldValue"`
	NewValue   string `json:"newValue"`
	ChangeType string `json:"changeType"` // added, removed, modified
	VisualIcon string `json:"visualIcon"` // +, -, ~, →
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
	ChangeType       string  `json:"changeType"` // increased, decreased, new, anomalous
	CurrentCost      float64 `json:"currentCost"`
	PreviousCost     float64 `json:"previousCost"`
	ChangeAmount     float64 `json:"changeAmount"`
	ChangePercent    float64 `json:"changePercent"`
	IsAnomaly        bool    `json:"isAnomaly"`
	AnomalyScore     float64 `json:"anomalyScore"`
}

type CostAnomaly struct {
	ResourceGroup    string    `json:"resourceGroup"`
	Date             string    `json:"date"`
	ExpectedCost     float64   `json:"expectedCost"`
	ActualCost       float64   `json:"actualCost"`
	Deviation        float64   `json:"deviation"`
	DeviationPercent float64   `json:"deviationPercent"`
	Severity         string    `json:"severity"` // low, medium, high, critical
}

type ResourceTypeBreakdown struct {
	ResourceType      string             `json:"resourceType"`
	CurrentMonthCost  float64            `json:"currentMonthCost"`
	PreviousMonthCost float64            `json:"previousMonthCost"`
	CostChange        float64            `json:"costChange"`
	ResourceCount     int                `json:"resourceCount"`
	PercentageOfTotal float64            `json:"percentageOfTotal"`
	TopResources      []ResourceCostSummary `json:"topResources"`
}

type SubscriptionComparison struct {
	SubscriptionID        string  `json:"subscriptionId"`
	SubscriptionName      string  `json:"subscriptionName"`
	CurrentMonthCost      float64 `json:"currentMonthCost"`
	PreviousMonthCost     float64 `json:"previousMonthCost"`
	CostChange            float64 `json:"costChange"`
	CostChangePercent     float64 `json:"costChangePercent"`
	ResourceGroupCount    int     `json:"resourceGroupCount"`
	ResourceCount         int     `json:"resourceCount"`
	PercentageOfTotal     float64 `json:"percentageOfTotal"`
	Rank                  int     `json:"rank"`
}

// CostVelocity tracks the rate and momentum of cost changes
type CostVelocity struct {
	Period              string  `json:"period"`              // "daily", "weekly", "monthly"
	CurrentRate         float64 `json:"currentRate"`         // Cost per day/week
	PreviousRate        float64 `json:"previousRate"`        // Previous period rate
	Acceleration        float64 `json:"acceleration"`        // Rate of change in velocity
	MomentumDirection   string  `json:"momentumDirection"`   // "accelerating", "decelerating", "stable"
	Projected7DayCost   float64 `json:"projected7DayCost"`
	Projected30DayCost  float64 `json:"projected30DayCost"`
	TrendStrength       float64 `json:"trendStrength"`       // 0-100, strength of trend
}

// ServiceLevelBreakdown provides detailed cost analysis by Azure service
type ServiceLevelBreakdown struct {
	ServiceName           string                   `json:"serviceName"`
	ServiceCategory       string                   `json:"serviceCategory"` // Compute, Storage, Network, Database, etc.
	CurrentMonthCost      float64                  `json:"currentMonthCost"`
	PreviousMonthCost     float64                  `json:"previousMonthCost"`
	CostChange            float64                  `json:"costChange"`
	CostChangePercent     float64                  `json:"costChangePercent"`
	PercentageOfTotal     float64                  `json:"percentageOfTotal"`
	ResourceCount         int                      `json:"resourceCount"`
	TopResourceGroups     []ServiceRGUsage         `json:"topResourceGroups"`
	DailyCosts            []ServiceDailyCost       `json:"dailyCosts"`
	MeterDetails          []ServiceMeterDetail     `json:"meterDetails"`
}

type ServiceRGUsage struct {
	ResourceGroup    string  `json:"resourceGroup"`
	Cost             float64 `json:"cost"`
	Percentage       float64 `json:"percentage"`
	ResourceCount    int     `json:"resourceCount"`
}

type ServiceDailyCost struct {
	Date        string  `json:"date"`
	Cost        float64 `json:"cost"`
	UsageUnits  float64 `json:"usageUnits"`
	UnitPrice   float64 `json:"unitPrice"`
}

type ServiceMeterDetail struct {
	MeterName       string  `json:"meterName"`
	MeterCategory   string  `json:"meterCategory"`
	Cost            float64 `json:"cost"`
	UsageQuantity   float64 `json:"usageQuantity"`
	Unit            string  `json:"unit"`
}

// GeographicDistribution shows cost distribution by Azure region
type GeographicDistribution struct {
	Region              string                  `json:"region"`
	RegionFullName      string                  `json:"regionFullName"`
	CurrentMonthCost    float64                 `json:"currentMonthCost"`
	PreviousMonthCost   float64                 `json:"previousMonthCost"`
	CostChange          float64                 `json:"costChange"`
	ResourceCount       int                     `json:"resourceCount"`
	PercentageOfTotal   float64                 `json:"percentageOfTotal"`
	Services            []RegionServiceBreakdown `json:"services"`
	CarbonIntensity     float64                 `json:"carbonIntensity"` // kg CO2/kWh
	RenewablePercentage float64                 `json:"renewablePercentage"`
}

type RegionServiceBreakdown struct {
	ServiceName     string  `json:"serviceName"`
	Cost            float64 `json:"cost"`
	ResourceCount   int     `json:"resourceCount"`
}

// UsageEfficiencyMetrics tracks resource utilization and efficiency
type UsageEfficiencyMetrics struct {
	ResourceID          string                 `json:"resourceId"`
	ResourceName        string                 `json:"resourceName"`
	ResourceType        string                 `json:"resourceType"`
	ResourceGroup       string                 `json:"resourceGroup"`
	Location            string                 `json:"location"`
	CurrentCost         float64                `json:"currentCost"`
	EfficiencyScore     int                    `json:"efficiencyScore"`     // 0-100
	UtilizationPercent  float64                `json:"utilizationPercent"`  // CPU/Memory/Bandwidth
	UptimePercent       float64                `json:"uptimePercent"`
	CostPerUnitUsage    float64                `json:"costPerUnitUsage"`    // Cost per utilization unit
	PotentialSavings    float64                `json:"potentialSavings"`
	Recommendation      string                 `json:"recommendation"`
	Metrics             map[string]MetricStats `json:"metrics"`
	HourlyPatterns      []HourlyUsagePattern   `json:"hourlyPatterns"`
}

type HourlyUsagePattern struct {
	Hour          int     `json:"hour"`
	AvgCPU        float64 `json:"avgCpu"`
	AvgMemory     float64 `json:"avgMemory"`
	AvgNetwork    float64 `json:"avgNetwork"`
	PeakTimes     []int   `json:"peakTimes"`
	IdleTimes     []int   `json:"idleTimes"`
}

// ResourceGroupChangeTimeline provides chronological view of changes
type ResourceGroupChangeTimeline struct {
	ResourceGroup    string                   `json:"resourceGroup"`
	SubscriptionID   string                   `json:"subscriptionId"`
	Events           []ResourceChangeEvent      `json:"events"`
	CostTrajectory   []CostTrajectoryPoint      `json:"costTrajectory"`
}

type ResourceChangeEvent struct {
	Timestamp       time.Time `json:"timestamp"`
	EventType       string    `json:"eventType"`       // "scale_up", "scale_down", "created", "deleted", "tagged"
	Description     string    `json:"description"`
	CostImpact      float64   `json:"costImpact"`      // Estimated cost change from event
	ResourceCount   int       `json:"resourceCount"`
	TriggeredBy     string    `json:"triggeredBy"`     // user, system, schedule
}

type CostTrajectoryPoint struct {
	Date        string  `json:"date"`
	Cumulative  float64 `json:"cumulative"`  // Running total for month
	Daily       float64 `json:"daily"`       // Cost for that day
	Change      float64 `json:"change"`      // Change from previous day
}

// BudgetTracking provides budget vs actual analysis
type BudgetTracking struct {
	BudgetName          string                `json:"budgetName"`
	BudgetAmount        float64               `json:"budgetAmount"`
	ActualSpend         float64               `json:"actualSpend"`
	RemainingBudget     float64               `json:"remainingBudget"`
	UtilizationPercent  float64               `json:"utilizationPercent"`
	ForecastedOverspend float64               `json:"forecastedOverspend"`
	DaysRemaining       int                   `json:"daysRemaining"`
	DailyBurnRate       float64               `json:"dailyBurnRate"`
	ProjectedMonthEnd   float64               `json:"projectedMonthEnd"`
	Status              string                `json:"status"` // "under", "approaching", "over"
	Alerts              []BudgetAlert         `json:"alerts"`
	ResourceGroupBudgets []ResourceGroupBudget `json:"resourceGroupBudgets"`
}

type BudgetAlert struct {
	Level       string  `json:"level"`       // "info", "warning", "critical"
	Message     string  `json:"message"`
	TriggeredAt string  `json:"triggeredAt"`
	Threshold   float64 `json:"threshold"`
	Current     float64 `json:"current"`
}

type ResourceGroupBudget struct {
	ResourceGroup  string  `json:"resourceGroup"`
	Budget         float64 `json:"budget"`
	Actual         float64 `json:"actual"`
	Variance       float64 `json:"variance"`
	VariancePercent float64 `json:"variancePercent"`
	Status         string  `json:"status"`
}

// ResourceDrift tracks configuration and cost drift over time
type ResourceDrift struct {
	ResourceID        string            `json:"resourceId"`
	ResourceName      string            `json:"resourceName"`
	ResourceGroup     string            `json:"resourceGroup"`
	ResourceType      string            `json:"resourceType"`
	DriftType         string            `json:"driftType"`         // "cost", "config", "tag"
	DriftSeverity     string            `json:"driftSeverity"`     // "low", "medium", "high"
	ExpectedCost      float64           `json:"expectedCost"`
	ActualCost        float64           `json:"actualCost"`
	CostDriftPercent  float64           `json:"costDriftPercent"`
	FirstDetected     time.Time         `json:"firstDetected"`
	LastChecked       time.Time         `json:"lastChecked"`
	DriftDuration     string            `json:"driftDuration"`
	ConfigChanges     []ConfigChange    `json:"configChanges"`
	RecommendedAction string            `json:"recommendedAction"`
}

type ConfigChange struct {
	Timestamp   time.Time `json:"timestamp"`
	Property    string    `json:"property"`
	OldValue    string    `json:"oldValue"`
	NewValue    string    `json:"newValue"`
	CostImpact  float64   `json:"costImpact"`
}

// MonthlyTrend provides multi-month trend analysis
type MonthlyTrend struct {
	Month            string                 `json:"month"`            // "January 2026"
	MonthNumber      int                    `json:"monthNumber"`      // 1-12
	Year             int                    `json:"year"`
	TotalCost        float64                `json:"totalCost"`
	ResourceCount    int                    `json:"resourceCount"`
	RGCount          int                    `json:"rgCount"`
	AverageDailyCost float64                `json:"averageDailyCost"`
	PeakDayCost      float64                `json:"peakDayCost"`
	GrowthRate       float64                `json:"growthRate"`       // vs previous month
	CumulativeGrowth float64                `json:"cumulativeGrowth"` // vs first month
	TopServices      []ServiceMonthSummary  `json:"topServices"`
	DailyBreakdown   []DailyCostSummary     `json:"dailyBreakdown"`
}

type ServiceMonthSummary struct {
	ServiceName   string  `json:"serviceName"`
	Cost          float64 `json:"cost"`
	Percentage    float64 `json:"percentage"`
	ChangePercent float64 `json:"changePercent"`
}

type DailyCostSummary struct {
	Day         int     `json:"day"`
	Cost        float64 `json:"cost"`
	ResourceCount int   `json:"resourceCount"`
	IsWeekend   bool    `json:"isWeekend"`
}

// CostAttribution tracks costs by business dimensions
type CostAttribution struct {
	Dimension       string                 `json:"dimension"`       // "team", "project", "environment", "costCenter"
	DimensionValue  string                 `json:"dimensionValue"`
	CurrentCost     float64                `json:"currentCost"`
	PreviousCost    float64                `json:"previousCost"`
	ChangePercent   float64                `json:"changePercent"`
	PercentageOfTotal float64              `json:"percentageOfTotal"`
	ResourceCount   int                    `json:"resourceCount"`
	TopRGs          []AttributedRG         `json:"topRGs"`
	Trend           string                 `json:"trend"`           // "up", "down", "stable"
	Owner           string                 `json:"owner"`
	ChargebackAmount float64               `json:"chargebackAmount"`
}

type AttributedRG struct {
	ResourceGroup string  `json:"resourceGroup"`
	Cost          float64 `json:"cost"`
	Percentage    float64 `json:"percentage"`
}

// CostCorrelation shows relationships between cost factors
type CostCorrelation struct {
	FactorA           string  `json:"factorA"`
	FactorB           string  `json:"factorB"`
	CorrelationType   string  `json:"correlationType"` // "positive", "negative", "none"
	CorrelationScore  float64 `json:"correlationScore"` // -1.0 to 1.0
	Strength          string  `json:"strength"`        // "strong", "moderate", "weak"
	Description       string  `json:"description"`
	SampleSize        int     `json:"sampleSize"`
}

// AnomalyPattern identifies recurring anomaly patterns
type AnomalyPattern struct {
	PatternID         string            `json:"patternId"`
	PatternName       string            `json:"patternName"`
	PatternType       string            `json:"patternType"` // "spike", "dip", "trend", "seasonal"
	Frequency         string            `json:"frequency"` // "daily", "weekly", "monthly"
	AffectedResources []string          `json:"affectedResources"`
	AffectedServices  []string          `json:"affectedServices"`
	TypicalMagnitude   float64          `json:"typicalMagnitude"`
	FirstObserved     time.Time         `json:"firstObserved"`
	LastObserved      time.Time         `json:"lastObserved"`
	OccurrenceCount   int               `json:"occurrenceCount"`
	RootCauseHints    []string          `json:"rootCauseHints"`
	MitigationStatus  string            `json:"mitigationStatus"` // "open", "mitigated", "monitoring"
}

// ComparisonMatrices provides matrix views for comparisons
type ComparisonMatrices struct {
	RGToServiceMatrix     []RGServiceCross   `json:"rgToServiceMatrix"`
	SubscriptionMatrix    []SubComparison    `json:"subscriptionMatrix"`
	TimeComparisonMatrix  []TimeComparison   `json:"timeComparisonMatrix"`
	CostToUsageMatrix     []CostUsageCorrelation `json:"costToUsageMatrix"`
}

type RGServiceCross struct {
	ResourceGroup string  `json:"resourceGroup"`
	ServiceName   string  `json:"serviceName"`
	Cost          float64 `json:"cost"`
	ResourceCount int     `json:"resourceCount"`
	Percentage    float64 `json:"percentage"`
}

type SubComparison struct {
	SubscriptionA   string  `json:"subscriptionA"`
	SubscriptionB   string  `json:"subscriptionB"`
	CostA           float64 `json:"costA"`
	CostB           float64 `json:"costB"`
	Ratio           float64 `json:"ratio"`
	CostDifference  float64 `json:"costDifference"`
	PercentageDiff  float64 `json:"percentageDiff"`
}

type TimeComparison struct {
	PeriodA         string  `json:"periodA"`
	PeriodB         string  `json:"periodB"`
	CostA           float64 `json:"costA"`
	CostB           float64 `json:"costB"`
	ChangePercent   float64 `json:"changePercent"`
	DaysBetween     int     `json:"daysBetween"`
}

type CostUsageCorrelation struct {
	ResourceID      string  `json:"resourceId"`
	ResourceName    string  `json:"resourceName"`
	Cost            float64 `json:"cost"`
	UsageAmount     float64 `json:"usageAmount"`
	UnitCost        float64 `json:"unitCost"`
	EfficiencyScore int     `json:"efficiencyScore"`
}

// DailyCostHeatmap provides day-by-day cost heatmaps
type DailyCostHeatmap struct {
	ResourceGroup string          `json:"resourceGroup"`
	Month         string          `json:"month"`
	Year          int             `json:"year"`
	Days          []HeatmapDay    `json:"days"`
	MaxDailyCost  float64         `json:"maxDailyCost"`
	MinDailyCost  float64         `json:"minDailyCost"`
	AvgDailyCost  float64         `json:"avgDailyCost"`
	TotalCost     float64         `json:"totalCost"`
	ColorScale    []ColorScale    `json:"colorScale"`
}

type HeatmapDay struct {
	Day         int     `json:"day"`
	Cost        float64 `json:"cost"`
	Intensity   float64 `json:"intensity"` // 0.0 to 1.0
	Color       string  `json:"color"`     // hex color code
	IsWeekend   bool    `json:"isWeekend"`
	IsHoliday   bool    `json:"isHoliday"`
	HasAnomaly  bool    `json:"hasAnomaly"`
	ChangeFromPrev float64 `json:"changeFromPrev"`
}

type ColorScale struct {
	MinValue    float64 `json:"minValue"`
	MaxValue    float64 `json:"maxValue"`
	Color       string  `json:"color"`
	Label       string  `json:"label"`
}

// ResourceGroupScorecard provides comprehensive RG scoring
type ResourceGroupScorecard struct {
	ResourceGroup       string                `json:"resourceGroup"`
	SubscriptionID      string                `json:"subscriptionId"`
	SubscriptionName    string                `json:"subscriptionName"`
	OverallScore        int                   `json:"overallScore"`      // 0-100
	CostEfficiencyScore int                   `json:"costEfficiencyScore"`
	SecurityScore       int                   `json:"securityScore"`
	OperationalScore    int                   `json:"operationalScore"`
	SustainabilityScore int                   `json:"sustainabilityScore"`
	CurrentMonthCost    float64               `json:"currentMonthCost"`
	CostChangePercent   float64               `json:"costChangePercent"`
	ResourceCount       int                   `json:"resourceCount"`
	TagCompliance       float64               `json:"tagCompliance"`     // percentage
	Findings            []ScorecardFinding    `json:"findings"`
	Recommendations     []ScorecardRecommendation `json:"recommendations"`
	TrendDirection      string                `json:"trendDirection"`    // "improving", "declining", "stable"
	RiskLevel           string                `json:"riskLevel"`         // "low", "medium", "high", "critical"
}

type ScorecardFinding struct {
	Category    string  `json:"category"`    // "cost", "security", "operational"
	Severity    string  `json:"severity"`    // "info", "warning", "critical"
	Description string  `json:"description"`
	Impact      float64 `json:"impact"`      // cost impact or score impact
}

type ScorecardRecommendation struct {
	Priority    string  `json:"priority"`    // "high", "medium", "low"
	Category    string  `json:"category"`
	Action      string  `json:"action"`
	PotentialSavings float64 `json:"potentialSavings"`
	Effort      string  `json:"effort"`     // "low", "medium", "high"
}

// TrendLinePoint provides data for trend line graphs
type TrendLinePoint struct {
	Date          string  `json:"date"`
	Timestamp     int64   `json:"timestamp"`     // Unix timestamp for charting
	ActualCost    float64 `json:"actualCost"`
	ProjectedCost float64 `json:"projectedCost"`
	BaselineCost  float64 `json:"baselineCost"`  // Same day last month
	MovingAvg7    float64 `json:"movingAvg7"`    // 7-day moving average
	MovingAvg30   float64 `json:"movingAvg30"`   // 30-day moving average
	UpperBound    float64 `json:"upperBound"`    // Confidence interval
	LowerBound    float64 `json:"lowerBound"`
	IsProjected   bool    `json:"isProjected"`
}

// CostScenario models what-if scenarios
type CostScenario struct {
	ScenarioID          string              `json:"scenarioId"`
	ScenarioName        string              `json:"scenarioName"`      // "Conservative", "Aggressive", "Optimized"
	Description         string              `json:"description"`
	Assumptions         []string            `json:"assumptions"`
	CurrentMonthProjected float64             `json:"currentMonthProjected"`
	NextMonthProjected    float64             `json:"nextMonthProjected"`
	QuarterProjected      float64             `json:"quarterProjected"`
	AnnualProjected       float64             `json:"annualProjected"`
	SavingsVsBaseline     float64             `json:"savingsVsBaseline"`
	SavingsPercent        float64             `json:"savingsPercent"`
	RequiredActions       []ScenarioAction    `json:"requiredActions"`
	Probability           float64             `json:"probability"`       // 0-100
	RiskLevel             string              `json:"riskLevel"`         // "low", "medium", "high"
}

type ScenarioAction struct {
	Action      string  `json:"action"`
	Impact      float64 `json:"impact"`      // Cost impact
	Difficulty  string  `json:"difficulty"` // "easy", "medium", "hard"
	Timeframe   string  `json:"timeframe"`  // "immediate", "short", "long"
}

// ExportDataBundle provides ready-to-export data formats
type ExportDataBundle struct {
	CSVData         CSVExportData         `json:"csvData"`
	JSONData        JSONExportData        `json:"jsonData"`
	ChartData       ChartExportData       `json:"chartData"`
	RawTimeSeries   []TimeSeriesPoint     `json:"rawTimeSeries"`
}

type CSVExportData struct {
	Headers     []string   `json:"headers"`
	Rows        [][]string `json:"rows"`
	Filename    string     `json:"filename"`
	RecordCount int        `json:"recordCount"`
}

type JSONExportData struct {
	FullReport   interface{} `json:"fullReport"`
	SummaryOnly  interface{} `json:"summaryOnly"`
	RawJSON      string      `json:"rawJson"`
}

type ChartExportData struct {
	Labels              []string    `json:"labels"`
	Datasets            []ChartDataset `json:"datasets"`
	RecommendedChartType string     `json:"recommendedChartType"`
	ColorPalette        []string    `json:"colorPalette"`
}

type ChartDataset struct {
	Label           string    `json:"label"`
	Data            []float64 `json:"data"`
	BackgroundColor []string  `json:"backgroundColor"`
	BorderColor     []string  `json:"borderColor"`
	BorderWidth     int       `json:"borderWidth"`
	Fill            bool      `json:"fill"`
	Tension         float64   `json:"tension"` // 0-1 for line smoothing
}

type TimeSeriesPoint struct {
	Timestamp   int64   `json:"timestamp"`
	Value       float64 `json:"value"`
	ResourceID  string  `json:"resourceId,omitempty"`
	MetricType  string  `json:"metricType"` // "cost", "usage", "efficiency"
}

// ColorIndicators provides color-coded visual indicators
type ColorIndicators struct {
	OverallHealth     HealthIndicator     `json:"overallHealth"`
	CostStatus        StatusIndicator     `json:"costStatus"`
	EfficiencyStatus  StatusIndicator     `json:"efficiencyStatus"`
	BudgetStatus      StatusIndicator     `json:"budgetStatus"`
	SecurityStatus    StatusIndicator     `json:"securityStatus"`
	RGHealthScores    []RGHealthIndicator `json:"rgHealthScores"`
	TrendColors       TrendColorMap       `json:"trendColors"`
}

type HealthIndicator struct {
	Score       int    `json:"score"`       // 0-100
	Status      string `json:"status"`      // "excellent", "good", "warning", "critical"
	Color       string `json:"color"`       // Hex color code
	Emoji       string `json:"emoji"`       // Visual indicator
	Description string `json:"description"`
}

type StatusIndicator struct {
	Value       float64 `json:"value"`
	Threshold   float64 `json:"threshold"`
	Status      string  `json:"status"`      // "under", "over", "approaching"
	Color       string  `json:"color"`
	ProgressBar ProgressInfo `json:"progressBar"`
}

type ProgressInfo struct {
	Percentage  float64 `json:"percentage"`
	Color       string  `json:"color"`
	Width       string  `json:"width"`       // CSS width
}

type RGHealthIndicator struct {
	ResourceGroup string `json:"resourceGroup"`
	HealthScore   int    `json:"healthScore"`
	Status        string `json:"status"`
	Color         string `json:"color"`
	Emoji         string `json:"emoji"`
	Trend         string `json:"trend"`       // "↑", "↓", "→"
}

type TrendColorMap struct {
	PositiveColor string `json:"positiveColor"` // Green for good trends
	NegativeColor string `json:"negativeColor"` // Red for concerning trends
	NeutralColor  string `json:"neutralColor"`
	GradientStart string `json:"gradientStart"`
	GradientEnd   string `json:"gradientEnd"`
}

// DrillDownLevel provides hierarchical drill-down data
type DrillDownLevel struct {
	Level          int                    `json:"level"`          // 0: Subscription, 1: RG, 2: Resource, 3: Meter
	LevelName      string                 `json:"levelName"`
	ParentID       string                 `json:"parentId"`
	ParentName     string                 `json:"parentName"`
	Items          []DrillDownItem        `json:"items"`
	TotalCost      float64                `json:"totalCost"`
	ItemCount      int                    `json:"itemCount"`
	CanDrillDown   bool                   `json:"canDrillDown"`
}

type DrillDownItem struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Cost            float64 `json:"cost"`
	Percentage      float64 `json:"percentage"`
	ChangePercent   float64 `json:"changePercent"`
	ChildCount      int     `json:"childCount"`
	HasChildren     bool    `json:"hasChildren"`
	Color           string  `json:"color"`
	Icon            string  `json:"icon"`
}

// PDFReportSummary provides formatted data for PDF generation
type PDFReportSummary struct {
	Title              string           `json:"title"`
	Subtitle           string           `json:"subtitle"`
	GeneratedDate      string           `json:"generatedDate"`
	ReportPeriod       string           `json:"reportPeriod"`
	TotalCost          float64          `json:"totalCost"`
	TotalChange        float64          `json:"totalChange"`
	ChangePercent      float64          `json:"changePercent"`
	KeyMetrics         []PDFMetric      `json:"keyMetrics"`
	TopSections        []PDFSection     `json:"topSections"`
	ChartData          PDFChartData     `json:"chartData"`
	Recommendations    []PDFRecommendation `json:"recommendations"`
	FooterText         string           `json:"footerText"`
}

type PDFMetric struct {
	Label       string  `json:"label"`
	Value       string  `json:"value"`
	Change      string  `json:"change"`
	Color       string  `json:"color"`
	Icon        string  `json:"icon"`
}

type PDFSection struct {
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Cost         float64  `json:"cost"`
	Items        []string `json:"items"`
	PageNumber   int      `json:"pageNumber"`
}

type PDFChartData struct {
	PieChartLabels []string  `json:"pieChartLabels"`
	PieChartValues []float64 `json:"pieChartValues"`
	PieChartColors []string  `json:"pieChartColors"`
	BarChartLabels []string  `json:"barChartLabels"`
	BarChartValues []float64 `json:"barChartValues"`
	LineChartData  []PDFLineSeries `json:"lineChartData"`
}

type PDFLineSeries struct {
	Name   string    `json:"name"`
	Data   []float64 `json:"data"`
	Color  string    `json:"color"`
}

type PDFRecommendation struct {
	Priority      string  `json:"priority"`
	Title         string  `json:"title"`
	Description   string  `json:"description"`
	Savings       float64 `json:"savings"`
	Effort        string  `json:"effort"`
}

// NotificationTrigger defines alert conditions
type NotificationTrigger struct {
	TriggerID       string            `json:"triggerId"`
	Name            string            `json:"name"`
	Condition       string            `json:"condition"`       // "cost_exceeds", "cost_change", "budget_threshold"
	Threshold       float64           `json:"threshold"`
	CurrentValue    float64           `json:"currentValue"`
	IsTriggered     bool              `json:"isTriggered"`
	TriggerCount    int               `json:"triggerCount"`
	LastTriggered   time.Time         `json:"lastTriggered"`
	Severity        string            `json:"severity"`
	Recipients      []string          `json:"recipients"`
	Actions         []TriggerAction   `json:"actions"`
}

type TriggerAction struct {
	ActionType  string `json:"actionType"` // "email", "slack", "webhook", "sms"
	Target      string `json:"target"`
	Message     string `json:"message"`
	Enabled     bool   `json:"enabled"`
}

// HistoricalSnapshot captures point-in-time data
type HistoricalSnapshot struct {
	SnapshotID      string                 `json:"snapshotId"`
	Timestamp       time.Time              `json:"timestamp"`
	Period          string                 `json:"period"`
	TotalCost       float64                `json:"totalCost"`
	ResourceCount   int                    `json:"resourceCount"`
	RGCount         int                    `json:"rgCount"`
	TopServices     []SnapshotService      `json:"topServices"`
	DailyCosts      []SnapshotDailyCost    `json:"dailyCosts"`
	KeyChanges      []SnapshotChange       `json:"keyChanges"`
}

type SnapshotService struct {
	ServiceName string  `json:"serviceName"`
	Cost        float64 `json:"cost"`
	Percentage  float64 `json:"percentage"`
}

type SnapshotDailyCost struct {
	Day  int     `json:"day"`
	Cost float64 `json:"cost"`
}

type SnapshotChange struct {
	ResourceGroup string  `json:"resourceGroup"`
	ChangeType    string  `json:"changeType"`
	OldValue      float64 `json:"oldValue"`
	NewValue      float64 `json:"newValue"`
	ChangePercent float64 `json:"changePercent"`
}

// ChartConfiguration provides chart rendering configuration
type ChartConfiguration struct {
	DefaultChartType string            `json:"defaultChartType"`
	AvailableTypes   []string          `json:"availableTypes"`
	ColorSchemes     []ColorScheme     `json:"colorSchemes"`
	AxisConfig       ChartAxisConfig   `json:"axisConfig"`
	LegendConfig     ChartLegendConfig `json:"legendConfig"`
	AnimationConfig  ChartAnimation    `json:"animationConfig"`
}

type ColorScheme struct {
	Name   string   `json:"name"`
	Colors []string `json:"colors"`
}

type ChartAxisConfig struct {
	XAxisLabel    string  `json:"xAxisLabel"`
	YAxisLabel    string  `json:"yAxisLabel"`
	ShowGrid      bool    `json:"showGrid"`
	GridColor     string  `json:"gridColor"`
	TickFontSize  int     `json:"tickFontSize"`
	LabelFontSize int     `json:"labelFontSize"`
}

type ChartLegendConfig struct {
	Show          bool   `json:"show"`
	Position      string `json:"position"` // "top", "bottom", "left", "right"
	FontSize      int    `json:"fontSize"`
	FontColor     string `json:"fontColor"`
}

type ChartAnimation struct {
	Enabled       bool    `json:"enabled"`
	Duration      int     `json:"duration"` // milliseconds
	Easing        string  `json:"easing"`   // "linear", "easeIn", "easeOut"
}
