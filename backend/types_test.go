package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestNewOllamaCircuitBreaker(t *testing.T) {
	cb := NewOllamaCircuitBreaker()
	assert.NotNil(t, cb)
	assert.Equal(t, CircuitClosed, cb.state)
	assert.Equal(t, 3, cb.threshold)
	assert.Equal(t, 60*time.Second, cb.timeout)
	assert.Equal(t, 30*time.Second, cb.halfOpenMaxWait)
	assert.Equal(t, 0, cb.failures)
}

func TestCircuitBreaker_IsOpen_ClosedState(t *testing.T) {
	cb := NewOllamaCircuitBreaker()
	assert.False(t, cb.IsOpen(), "Circuit should not be open in closed state")
}

func TestCircuitBreaker_IsOpen_OpenState(t *testing.T) {
	cb := NewOllamaCircuitBreaker()

	// Force circuit to open by recording failures
	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()

	assert.True(t, cb.IsOpen(), "Circuit should be open after threshold failures")
}

func TestCircuitBreaker_IsOpen_TransitionsToHalfOpen(t *testing.T) {
	cb := NewOllamaCircuitBreaker()
	cb.timeout = 1 * time.Millisecond

	// Open the circuit
	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()
	assert.True(t, cb.IsOpen())

	// Wait for timeout
	time.Sleep(10 * time.Millisecond)

	// Should transition to half-open
	assert.False(t, cb.IsOpen(), "Circuit should transition to half-open after timeout")
}

func TestCircuitBreaker_RecordSuccess(t *testing.T) {
	cb := NewOllamaCircuitBreaker()

	// Open the circuit first
	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()
	assert.True(t, cb.IsOpen())

	// Record success should reset
	cb.RecordSuccess()

	assert.False(t, cb.IsOpen(), "Circuit should be closed after success")
	assert.Equal(t, 0, cb.failures)
	assert.Equal(t, CircuitClosed, cb.state)
}

func TestCircuitBreaker_RecordFailure(t *testing.T) {
	cb := NewOllamaCircuitBreaker()

	// First two failures shouldn't open circuit
	cb.RecordFailure()
	assert.False(t, cb.IsOpen())

	cb.RecordFailure()
	assert.False(t, cb.IsOpen())

	// Third failure should open circuit
	cb.RecordFailure()
	assert.True(t, cb.IsOpen())
}

func TestCircuitBreaker_HalfOpenToOpen(t *testing.T) {
	cb := NewOllamaCircuitBreaker()
	cb.timeout = 1 * time.Millisecond

	// Open circuit
	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()

	// Wait and transition to half-open
	time.Sleep(10 * time.Millisecond)
	cb.IsOpen() // This transitions to half-open

	// Force into half-open state manually to test transition back to open
	cb.mu.Lock()
	cb.state = CircuitHalfOpen
	cb.mu.Unlock()

	// Failure in half-open should go back to open
	cb.RecordFailure()
	assert.True(t, cb.IsOpen(), "Failure in half-open should return to open")
}

func TestCircuitBreaker_ConcurrentAccess(t *testing.T) {
	cb := NewOllamaCircuitBreaker()

	// Run concurrent operations
	done := make(chan bool, 100)

	for i := 0; i < 50; i++ {
		go func() {
			cb.IsOpen()
			done <- true
		}()
	}

	for i := 0; i < 50; i++ {
		go func() {
			cb.RecordFailure()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}

	// Circuit should be open after many failures
	assert.True(t, cb.IsOpen() || cb.failures > 0, "Circuit should have recorded failures")
}

// Test Subscription type
func TestSubscription_Struct(t *testing.T) {
	sub := Subscription{
		ID:       "sub-123",
		Name:     "Test Subscription",
		State:    "Enabled",
		TenantID: "tenant-456",
		Tags: map[string]string{
			"env": "test",
		},
	}

	assert.Equal(t, "sub-123", sub.ID)
	assert.Equal(t, "Test Subscription", sub.Name)
	assert.Equal(t, "Enabled", sub.State)
	assert.Equal(t, "tenant-456", sub.TenantID)
	assert.Equal(t, "test", sub.Tags["env"])
}

// Test AzureResource type
func TestAzureResource_Struct(t *testing.T) {
	resource := AzureResource{
		ID:               "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Compute/vm",
		Name:             "test-vm",
		Type:             "Microsoft.Compute/virtualMachines",
		Location:         "eastus",
		SubscriptionID:   "123",
		SubscriptionName: "Test Sub",
		ResourceGroup:    "rg",
		Status:           "Running",
		Tags:             map[string]string{"env": "prod"},
		Cost:             123.45,
		Score:            85,
		IsOrphaned:       false,
	}

	assert.Equal(t, "test-vm", resource.Name)
	assert.Equal(t, "Microsoft.Compute/virtualMachines", resource.Type)
	assert.Equal(t, 123.45, resource.Cost)
	assert.Equal(t, 85, resource.Score)
	assert.False(t, resource.IsOrphaned)
}

// Test CostPeriod constants
func TestCostPeriod_Constants(t *testing.T) {
	assert.Equal(t, CostPeriod("current"), CostPeriodCurrent)
	assert.Equal(t, CostPeriod("previous"), CostPeriodPrevious)
}

// Test ResourceChange type
func TestResourceChange_Struct(t *testing.T) {
	change := ResourceChange{
		ResourceID:   "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Compute/vm",
		ResourceName: "test-vm",
		ResourceType: "Microsoft.Compute/virtualMachines",
		ChangeType:   "modified",
		Field:        "tags",
		OldValue:     "{}",
		NewValue:     `{"env":"prod"}`,
		Cost:         50.0,
		ChangedBy:    "user@example.com",
	}

	assert.Equal(t, "test-vm", change.ResourceName)
	assert.Equal(t, "modified", change.ChangeType)
	assert.Equal(t, "user@example.com", change.ChangedBy)
}

// Test MetricStats type
func TestMetricStats_Struct(t *testing.T) {
	stats := MetricStats{
		Min:  10.0,
		Max:  100.0,
		Avg:  55.0,
		P95:  95.0,
		Unit: "Percent",
	}

	assert.Equal(t, 10.0, stats.Min)
	assert.Equal(t, 100.0, stats.Max)
	assert.Equal(t, 55.0, stats.Avg)
	assert.Equal(t, "Percent", stats.Unit)
}

// Test AIInsight type
func TestAIInsight_Struct(t *testing.T) {
	insight := AIInsight{
		ResourceID:      "res-123",
		ResourceName:    "test-resource",
		ResourceType:    "Microsoft.Compute/virtualMachines",
		ResourceGroup:   "rg-test",
		Location:        "eastus",
		SubscriptionID:  "sub-123",
		MonthlyCost:     100.0,
		Category:        "compute",
		ConfidenceScore: 0.85,
		OllamaAvailable: true,
		Metrics:         make(map[string][]float64),
		Recommendations: []Recommendation{},
	}

	assert.Equal(t, "test-resource", insight.ResourceName)
	assert.Equal(t, 0.85, insight.ConfidenceScore)
	assert.True(t, insight.OllamaAvailable)
}

// Test Recommendation type
func TestRecommendation_Struct(t *testing.T) {
	rec := Recommendation{
		Category:         "rightsize",
		Action:           "Downsize VM",
		EstimatedSavings: 50.0,
		SavingsPercent:   25.0,
		Rationale:        "Low CPU utilization",
		Priority:         1,
	}

	assert.Equal(t, "rightsize", rec.Category)
	assert.Equal(t, "Downsize VM", rec.Action)
	assert.Equal(t, 50.0, rec.EstimatedSavings)
	assert.Equal(t, 1, rec.Priority)
}
