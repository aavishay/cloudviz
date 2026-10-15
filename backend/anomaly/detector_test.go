package anomaly

import (
	"testing"
	"time"
)

func series(n int, base float64) ([]time.Time, []float64) {
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	dates := make([]time.Time, n)
	costs := make([]float64, n)
	for i := range dates {
		dates[i] = start.AddDate(0, 0, i)
		// Small, regular day-to-day variation around base.
		costs[i] = base + float64(i%3)
	}
	return dates, costs
}

func TestDetectFindsSpike(t *testing.T) {
	dates, costs := series(30, 100)
	costs[20] = 900 // one clear spike
	res := NewEnhancedDetector(DefaultDetectorConfig()).Detect("sub", dates, costs, nil, nil)

	found := false
	for _, a := range res.Anomalies {
		if a.Date == dates[20].Format("2006-01-02") {
			found = true
			if a.Severity == "" || len(a.Methods) == 0 {
				t.Errorf("spike result lacks severity or methods: %+v", a)
			}
		} else if a.CurrentCost < 200 {
			t.Errorf("ordinary day %s flagged as an anomaly (cost %.0f)", a.Date, a.CurrentCost)
		}
	}
	if !found {
		t.Fatalf("spike on %s not detected; got %+v", dates[20].Format("2006-01-02"), res.Anomalies)
	}
	if res.Summary.TotalAnomalies != len(res.Anomalies) {
		t.Errorf("summary total %d != %d anomalies", res.Summary.TotalAnomalies, len(res.Anomalies))
	}
}

func TestDetectSteadySeriesHasNoAnomalies(t *testing.T) {
	dates, costs := series(30, 100)
	res := NewEnhancedDetector(DefaultDetectorConfig()).Detect("sub", dates, costs, nil, nil)
	if len(res.Anomalies) != 0 {
		t.Errorf("steady series produced anomalies: %+v", res.Anomalies)
	}
}

func TestDetectRejectsMismatchedInput(t *testing.T) {
	dates, costs := series(5, 10)
	res := NewEnhancedDetector(DefaultDetectorConfig()).Detect("sub", dates, costs[:3], nil, nil)
	if len(res.Anomalies) != 0 {
		t.Errorf("mismatched dates/costs should yield nothing, got %+v", res.Anomalies)
	}
}

func TestSeverityFromString(t *testing.T) {
	for s, want := range map[string]AnomalySeverity{"critical": SeverityCritical, "high": SeverityHigh, "medium": SeverityMedium, "low": SeverityLow, "bogus": ""} {
		if got := SeverityFromString(s); got != want {
			t.Errorf("SeverityFromString(%q) = %q, want %q", s, got, want)
		}
	}
}
