package anomaly

import (
	"math"
	"sort"
)

// MADResult contains the results of MAD-based anomaly detection
type MADResult struct {
	IsAnomaly   bool
	MADScore    float64 // Modified z-score using MAD
	MAD         float64 // Median Absolute Deviation
	Median      float64
	Threshold   float64
}

// CalculateMAD computes the Median Absolute Deviation
// MAD = median(|xi - median(x)|)
func CalculateMAD(values []float64) (median, mad float64) {
	if len(values) == 0 {
		return 0, 0
	}

	// Calculate median
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)

	n := len(sorted)
	if n%2 == 0 {
		median = (sorted[n/2-1] + sorted[n/2]) / 2
	} else {
		median = sorted[n/2]
	}

	// Calculate absolute deviations from median
	deviations := make([]float64, n)
	for i, v := range values {
		deviations[i] = math.Abs(v - median)
	}

	// Calculate median of deviations
	sort.Float64s(deviations)
	if n%2 == 0 {
		mad = (deviations[n/2-1] + deviations[n/2]) / 2
	} else {
		mad = deviations[n/2]
	}

	return median, mad
}

// ModifiedZScore calculates the modified z-score using MAD
// Modified Z-Score = 0.6745 * (xi - median) / MAD
// The constant 0.6745 makes the MAD comparable to standard deviation
func ModifiedZScore(value, median, mad float64) float64 {
	if mad == 0 {
		// If MAD is 0, all values are the same or very close
		if math.Abs(value-median) < 0.0001 {
			return 0
		}
		return 999 // Very anomalous
	}
	return 0.6745 * (value - median) / mad
}

// DetectMADAnomalies finds anomalies using MAD
func DetectMADAnomalies(values []float64, threshold float64) []MADResult {
	if len(values) == 0 {
		return nil
	}

	median, mad := CalculateMAD(values)
	results := make([]MADResult, len(values))

	for i, v := range values {
		score := ModifiedZScore(v, median, mad)
		results[i] = MADResult{
			IsAnomaly: math.Abs(score) >= threshold,
			MADScore:  score,
			MAD:       mad,
			Median:    median,
			Threshold: threshold,
		}
	}

	return results
}

// DetectMADAnomaliesIndexed finds anomalies and returns their indices
func DetectMADAnomaliesIndexed(values []float64, threshold float64) []int {
	results := DetectMADAnomalies(values, threshold)
	var anomalies []int
	for i, r := range results {
		if r.IsAnomaly {
			anomalies = append(anomalies, i)
		}
	}
	return anomalies
}

// MADDetector provides a reusable MAD-based anomaly detector
type MADDetector struct {
	median    float64
	mad       float64
	threshold float64
}

// NewMADDetector creates a new MAD detector from training data
func NewMADDetector(values []float64, threshold float64) *MADDetector {
	median, mad := CalculateMAD(values)
	return &MADDetector{
		median:    median,
		mad:       mad,
		threshold: threshold,
	}
}

// Detect checks if a value is anomalous
func (d *MADDetector) Detect(value float64) MADResult {
	score := ModifiedZScore(value, d.median, d.mad)
	return MADResult{
		IsAnomaly: math.Abs(score) >= d.threshold,
		MADScore:  score,
		MAD:       d.mad,
		Median:    d.median,
		Threshold: d.threshold,
	}
}
