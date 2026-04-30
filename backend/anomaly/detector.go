package anomaly

import (
	"math"
	"time"
)

// DetectorConfig configures the enhanced anomaly detector
type DetectorConfig struct {
	ZScoreThreshold    float64
	MADThreshold       float64
	IsolationThreshold float64
	SeasonalThreshold  float64
	UseZScore          bool
	UseMAD             bool
	UseIsolationForest bool
	UseSeasonal        bool
	MinSeverity        AnomalySeverity
}

// DefaultDetectorConfig returns a default configuration
func DefaultDetectorConfig() DetectorConfig {
	return DetectorConfig{
		ZScoreThreshold:      2.0,
		MADThreshold:         3.5,
		IsolationThreshold:   0.6,
		SeasonalThreshold:    2.5,
		UseZScore:            true,
		UseMAD:               true,
		UseIsolationForest:   true,
		UseSeasonal:          true,
		MinSeverity:          SeverityLow,
	}
}

// EnhancedDetector provides ML-based anomaly detection
type EnhancedDetector struct {
	config DetectorConfig
}

// NewEnhancedDetector creates a new enhanced detector
func NewEnhancedDetector(config DetectorConfig) *EnhancedDetector {
	return &EnhancedDetector{config: config}
}

// DetectResults contains all detection results
type DetectResults struct {
	Anomalies []EnhancedAnomalyResult
	Summary   DetectSummary
}

// DetectSummary provides statistics about detected anomalies
type DetectSummary struct {
	TotalAnomalies int
	BySeverity     map[AnomalySeverity]int
	ByMethod       map[string]int
	PeriodStart    string
	PeriodEnd      string
	MethodsUsed    []string
}

// Detect analyzes cost data and returns anomalies using multiple methods
func (d *EnhancedDetector) Detect(
	subscriptionID string,
	dates []time.Time,
	costs []float64,
	previousCosts []float64,
	forecastCosts []float64,
) DetectResults {
	if len(dates) != len(costs) || len(costs) == 0 {
		return DetectResults{
			Anomalies: []EnhancedAnomalyResult{},
			Summary: DetectSummary{
				BySeverity:  make(map[AnomalySeverity]int),
				ByMethod:    make(map[string]int),
				MethodsUsed: d.getMethodsUsed(),
			},
		}
	}

	var anomalies []EnhancedAnomalyResult
	bySeverity := make(map[AnomalySeverity]int)
	byMethod := make(map[string]int)
	thresholds := DefaultSeverityThresholds()

	// Pre-calculate statistics
	mean := CalculateMean(costs)
	stddev := CalculateStdDev(costs, mean)
	_, _ = CalculateMAD(costs) // Calculated for potential use

	// Prepare seasonal analyzer if needed
	var seasonalAnalyzer *SeasonalAnalyzer
	if d.config.UseSeasonal {
		seasonalAnalyzer = NewSeasonalAnalyzer(dates, costs, d.config.SeasonalThreshold)
	}

	// Prepare isolation forest if needed
	var isolationForest *IsolationForest
	if d.config.UseIsolationForest && len(costs) >= 14 {
		isolationForest = IsolationForestForCosts(costs)
	}

	// Prepare MAD detector
	var madDetector *MADDetector
	if d.config.UseMAD {
		madDetector = NewMADDetector(costs, d.config.MADThreshold)
	}

	// Analyze each point
	for i, date := range dates {
		currentCost := costs[i]
		previousCost := 0.0
		if i < len(previousCosts) {
			previousCost = previousCosts[i]
		}

		expectedCost := 0.0
		if i < len(forecastCosts) {
			expectedCost = forecastCosts[i]
		}

		result := EnhancedAnomalyResult{
			SubscriptionID: subscriptionID,
			Date:           date.Format("2006-01-02"),
			CurrentCost:    currentCost,
			PreviousCost:   previousCost,
			ExpectedCost:   expectedCost,
			DayOfWeek:      date.Weekday().String(),
		}

		// Track which methods flagged this
		var methods []string
		var scores []float64

		// Z-Score detection
		if d.config.UseZScore && stddev > 0 {
			zscore := (currentCost - mean) / stddev
			result.ZScore = zscore
			if math.Abs(zscore) >= d.config.ZScoreThreshold {
				methods = append(methods, "zscore")
				scores = append(scores, math.Abs(zscore))
			}
		}

		// MAD detection
		if d.config.UseMAD && madDetector != nil {
			madResult := madDetector.Detect(currentCost)
			result.MADScore = madResult.MADScore
			if madResult.IsAnomaly {
				methods = append(methods, "mad")
				scores = append(scores, math.Abs(madResult.MADScore))
			}
		}

		// Isolation Forest detection
		if d.config.UseIsolationForest && isolationForest != nil {
			isoResult := isolationForest.Detect([]float64{
				math.Log10(currentCost),
				0, // Change (calculated below if possible)
				0, // Rolling avg
			})
			result.IsolationScore = isoResult.Score
			if isoResult.IsAnomaly {
				methods = append(methods, "isolation_forest")
				scores = append(scores, isoResult.Score*10) // Scale to ~z-score range
			}
		}

		// Seasonal detection
		if d.config.UseSeasonal && seasonalAnalyzer != nil {
			seasonalResult := seasonalAnalyzer.Detect(date, currentCost)
			result.SeasonalScore = seasonalResult.SeasonalScore
			if seasonalResult.IsAnomaly {
				methods = append(methods, "seasonal")
				scores = append(scores, math.Abs(seasonalResult.SeasonalScore))
			}
		}

		// Forecast-based detection
		if expectedCost > 0 && currentCost > expectedCost*1.5 {
			methods = append(methods, "forecast")
			scores = append(scores, (currentCost-expectedCost)/expectedCost*5)
		}

		// Determine if this is an anomaly
		if len(methods) > 0 {
			result.Methods = methods

			// Calculate combined score (max of individual scores)
			maxScore := 0.0
			for _, s := range scores {
				if s > maxScore {
					maxScore = s
				}
			}
			result.Score = maxScore

			// Classify severity
			result.Severity = ClassifySeverity(maxScore, thresholds)

			// Determine trend
			if i > 0 && previousCost > 0 {
				change := (currentCost - previousCost) / previousCost
				switch {
				case change > 0.5:
					result.Trend = "spiking"
				case change > 0.1:
					result.Trend = "increasing"
				case change < -0.5:
					result.Trend = "dropping"
				case change < -0.1:
					result.Trend = "decreasing"
				default:
					result.Trend = "stable"
				}
			} else {
				result.Trend = "new"
			}

			// Filter by minimum severity
			if SeverityPriority(result.Severity) >= SeverityPriority(d.config.MinSeverity) {
				anomalies = append(anomalies, result)
				bySeverity[result.Severity]++
				for _, m := range methods {
					byMethod[m]++
				}
			}
		}
	}

	return DetectResults{
		Anomalies: anomalies,
		Summary: DetectSummary{
			TotalAnomalies: len(anomalies),
			BySeverity:     bySeverity,
			ByMethod:       byMethod,
			PeriodStart:    dates[0].Format("2006-01-02"),
			PeriodEnd:      dates[len(dates)-1].Format("2006-01-02"),
			MethodsUsed:    d.getMethodsUsed(),
		},
	}
}

// Config returns the detector configuration
func (d *EnhancedDetector) Config() DetectorConfig {
	return d.config
}

// getMethodsUsed returns list of methods enabled in config
func (d *EnhancedDetector) getMethodsUsed() []string {
	var methods []string
	if d.config.UseZScore {
		methods = append(methods, "zscore")
	}
	if d.config.UseMAD {
		methods = append(methods, "mad")
	}
	if d.config.UseIsolationForest {
		methods = append(methods, "isolation_forest")
	}
	if d.config.UseSeasonal {
		methods = append(methods, "seasonal")
	}
	return methods
}

// SeverityFromString converts string to AnomalySeverity
func SeverityFromString(s string) AnomalySeverity {
	switch s {
	case "critical":
		return SeverityCritical
	case "high":
		return SeverityHigh
	case "medium":
		return SeverityMedium
	case "low":
		return SeverityLow
	default:
		return ""
	}
}
