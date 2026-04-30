// Package anomaly provides ML-based anomaly detection algorithms
package anomaly

import (
	"math"
	"sort"
	"time"
)

// AnomalySeverity represents the severity level of an anomaly
type AnomalySeverity string

const (
	SeverityLow      AnomalySeverity = "low"      // z-score 2-3
	SeverityMedium   AnomalySeverity = "medium"   // z-score 3-4
	SeverityHigh     AnomalySeverity = "high"     // z-score 4-5
	SeverityCritical AnomalySeverity = "critical" // z-score 5+
)

// SeverityThresholds defines z-score thresholds for each severity level
type SeverityThresholds struct {
	Low      float64
	Medium   float64
	High     float64
	Critical float64
}

// DefaultSeverityThresholds returns default thresholds
func DefaultSeverityThresholds() SeverityThresholds {
	return SeverityThresholds{
		Low:      2.0,
		Medium:   3.0,
		High:     4.0,
		Critical: 5.0,
	}
}

// ClassifySeverity determines severity based on z-score
func ClassifySeverity(zscore float64, thresholds SeverityThresholds) AnomalySeverity {
	absScore := math.Abs(zscore)
	switch {
	case absScore >= thresholds.Critical:
		return SeverityCritical
	case absScore >= thresholds.High:
		return SeverityHigh
	case absScore >= thresholds.Medium:
		return SeverityMedium
	case absScore >= thresholds.Low:
		return SeverityLow
	default:
		return "" // Not an anomaly
	}
}

// SeverityPriority returns numeric priority for sorting (higher = more severe)
func SeverityPriority(s AnomalySeverity) int {
	switch s {
	case SeverityCritical:
		return 4
	case SeverityHigh:
		return 3
	case SeverityMedium:
		return 2
	case SeverityLow:
		return 1
	default:
		return 0
	}
}

// CostPoint represents a single cost data point
type CostPoint struct {
	Date time.Time
	Cost float64
}

// EnhancedAnomalyResult contains detailed anomaly information
type EnhancedAnomalyResult struct {
	SubscriptionID string          `json:"subscriptionId"`
	Date           string          `json:"date"`
	CurrentCost    float64         `json:"currentCost"`
	PreviousCost   float64         `json:"previousCost"`
	Severity       AnomalySeverity `json:"severity"`
	Score          float64         `json:"score"`       // Combined anomaly score
	Methods        []string        `json:"methods"`     // Which methods detected this

	// Method-specific scores
	ZScore         float64 `json:"zscore,omitempty"`
	MADScore       float64 `json:"madScore,omitempty"`
	IsolationScore float64 `json:"isolationScore,omitempty"`
	SeasonalScore  float64 `json:"seasonalScore,omitempty"`

	// Context
	ExpectedCost float64 `json:"expectedCost,omitempty"` // From forecast
	Trend        string  `json:"trend,omitempty"`        // "increasing", "decreasing", "stable"
	DayOfWeek    string  `json:"dayOfWeek,omitempty"`
}

// CalculateMedian returns the median of a float slice
func CalculateMedian(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}

	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)

	n := len(sorted)
	if n%2 == 0 {
		return (sorted[n/2-1] + sorted[n/2]) / 2
	}
	return sorted[n/2]
}

// CalculateMean returns the mean of a float slice
func CalculateMean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}

	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

// CalculateStdDev returns the standard deviation
func CalculateStdDev(values []float64, mean float64) float64 {
	if len(values) < 2 {
		return 0
	}

	variance := 0.0
	for _, v := range values {
		diff := v - mean
		variance += diff * diff
	}
	return math.Sqrt(variance / float64(len(values)))
}

// CalculateZScore calculates standard z-score
func CalculateZScore(value, mean, stddev float64) float64 {
	if stddev == 0 {
		return 0
	}
	return (value - mean) / stddev
}

// IsAnomaly checks if a value is anomalous based on z-score
func IsAnomaly(zscore float64, threshold float64) bool {
	return math.Abs(zscore) >= threshold
}
