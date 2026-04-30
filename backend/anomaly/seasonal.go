package anomaly

import (
	"math"
	"time"
)

// DayOfWeek represents a day of the week
type DayOfWeek int

const (
	Sunday DayOfWeek = iota
	Monday
	Tuesday
	Wednesday
	Thursday
	Friday
	Saturday
)

func (d DayOfWeek) String() string {
	names := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
	return names[d]
}

// SeasonalResult contains seasonal anomaly detection results
type SeasonalResult struct {
	IsAnomaly     bool
	DayOfWeek      DayOfWeek
	SeasonalScore   float64 // Z-score relative to same day of week
	DayAverage    float64 // Average for this day of week
	DayStdDev     float64 // Std dev for this day of week
	GlobalAverage float64 // Overall average
	GlobalStdDev  float64 // Overall std dev
}

// DayOfWeekStats holds statistics for a specific day of week
type DayOfWeekStats struct {
	DayOfWeek  DayOfWeek
	Count      int
	Sum        float64
	Mean       float64
	StdDev     float64
	Min        float64
	Max        float64
	Values     []float64
}

// SeasonalAnalyzer performs seasonal decomposition analysis
type SeasonalAnalyzer struct {
	dayStats    [7]*DayOfWeekStats
	globalMean  float64
	globalStdDev float64
	threshold   float64
}

// NewSeasonalAnalyzer creates a seasonal analyzer from time-series data
func NewSeasonalAnalyzer(dates []time.Time, values []float64, threshold float64) *SeasonalAnalyzer {
	if len(dates) != len(values) || len(dates) == 0 {
		return nil
	}

	sa := &SeasonalAnalyzer{threshold: threshold}

	// Initialize day stats
	for i := 0; i < 7; i++ {
		sa.dayStats[i] = &DayOfWeekStats{
			DayOfWeek: DayOfWeek(i),
			Values:    []float64{},
			Min:       math.MaxFloat64,
			Max:       -math.MaxFloat64,
		}
	}

	// Group values by day of week
	for i, date := range dates {
		dayOfWeek := int(date.Weekday())
		value := values[i]

		stats := sa.dayStats[dayOfWeek]
		stats.Count++
		stats.Sum += value
		stats.Values = append(stats.Values, value)

		if value < stats.Min {
			stats.Min = value
		}
		if value > stats.Max {
			stats.Max = value
		}
	}

	// Calculate day-specific statistics
	allValues := []float64{}
	for i := 0; i < 7; i++ {
		stats := sa.dayStats[i]
		if stats.Count > 0 {
			stats.Mean = stats.Sum / float64(stats.Count)

			// Calculate std dev
			if stats.Count > 1 {
				variance := 0.0
				for _, v := range stats.Values {
					diff := v - stats.Mean
					variance += diff * diff
				}
				stats.StdDev = math.Sqrt(variance / float64(stats.Count))
			}

			allValues = append(allValues, stats.Values...)
		}
	}

	// Calculate global statistics
	if len(allValues) > 0 {
		sa.globalMean = CalculateMean(allValues)
		sa.globalStdDev = CalculateStdDev(allValues, sa.globalMean)
	}

	return sa
}

// Detect checks if a value is anomalous for its day of week
func (sa *SeasonalAnalyzer) Detect(date time.Time, value float64) SeasonalResult {
	dayOfWeek := int(date.Weekday())
	stats := sa.dayStats[dayOfWeek]

	result := SeasonalResult{
		DayOfWeek:     DayOfWeek(dayOfWeek),
		DayAverage:    stats.Mean,
		DayStdDev:     stats.StdDev,
		GlobalAverage: sa.globalMean,
		GlobalStdDev:  sa.globalStdDev,
	}

	// Calculate seasonal z-score
	if stats.StdDev > 0 {
		result.SeasonalScore = (value - stats.Mean) / stats.StdDev
		result.IsAnomaly = math.Abs(result.SeasonalScore) >= sa.threshold
	} else if stats.Count > 0 {
		// All historical values for this day are the same
		result.IsAnomaly = math.Abs(value-stats.Mean) > 0.01
		if result.IsAnomaly {
			result.SeasonalScore = 999 // Very anomalous
		}
	}

	return result
}

// GetDayStats returns statistics for a specific day of week
func (sa *SeasonalAnalyzer) GetDayStats(day DayOfWeek) *DayOfWeekStats {
	return sa.dayStats[day]
}

// HasEnoughData checks if we have enough data for reliable seasonal analysis
func (sa *SeasonalAnalyzer) HasEnoughData(minSamplesPerDay int) bool {
	for i := 0; i < 7; i++ {
		if sa.dayStats[i].Count < minSamplesPerDay {
			return false
		}
	}
	return true
}

// WeekendEffect returns the average difference between weekend and weekday costs
func (sa *SeasonalAnalyzer) WeekendEffect() float64 {
	weekendAvg := (sa.dayStats[Sunday].Mean + sa.dayStats[Saturday].Mean) / 2
	weekdayAvg := (sa.dayStats[Monday].Mean + sa.dayStats[Tuesday].Mean +
		sa.dayStats[Wednesday].Mean + sa.dayStats[Thursday].Mean +
		sa.dayStats[Friday].Mean) / 5

	return weekendAvg - weekdayAvg
}

// DetectAll analyzes all points and returns seasonal results
func (sa *SeasonalAnalyzer) DetectAll(dates []time.Time, values []float64) []SeasonalResult {
	if len(dates) != len(values) {
		return nil
	}

	results := make([]SeasonalResult, len(dates))
	for i, date := range dates {
		results[i] = sa.Detect(date, values[i])
	}
	return results
}
