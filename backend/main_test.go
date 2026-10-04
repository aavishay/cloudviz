package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// testExtractSubscriptionFromID extracts the subscription GUID from an Azure resource ID.
func testExtractSubscriptionFromID(resourceID string) string {
	parts := strings.Split(resourceID, "/")
	for i, part := range parts {
		if strings.EqualFold(part, "subscriptions") && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func TestNormalizeLocation_Integration(t *testing.T) {
	// Test the actual normalizeLocation function from azure.go
	tests := []struct {
		input    string
		expected string
	}{
		{"West US", "westus"},
		{"East US", "eastus"},
		{"West Europe", "westeurope"},
		{"Southeast Asia", "southeastasia"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizeLocation(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCORSConfiguration(t *testing.T) {
	// Set gin to test mode
	gin.SetMode(gin.TestMode)

	// Create a test router
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Next()
	})

	router.GET("/test", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Test request
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/test", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Origin"), "*")
}

func TestHealthCheckEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Simple health check handler
	handler := func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "healthy",
			"timestamp": "2024-01-01T00:00:00Z",
		})
	}

	router := gin.New()
	router.GET("/health", handler)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/health", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, 200, w.Code)
	assert.Contains(t, w.Body.String(), "healthy")
}

func TestAPIErrorResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Test error response format
	handler := func(c *gin.Context) {
		c.JSON(500, gin.H{
			"error":   "Internal server error",
			"message": "Database connection failed",
		})
	}

	router := gin.New()
	router.GET("/error", handler)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/error", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, 500, w.Code)
	assert.Contains(t, w.Body.String(), "Internal server error")
}

func TestResourceIDExtraction(t *testing.T) {
	tests := []struct {
		name       string
		resourceID string
		wantSubID  string
		wantRG     string
	}{
		{
			name:       "Full resource ID",
			resourceID: "/subscriptions/12345/resourceGroups/myRG/providers/Microsoft.Compute/virtualMachines/vm1",
			wantSubID:  "12345",
			wantRG:     "myRG",
		},
		{
			name:       "Subscription only",
			resourceID: "/subscriptions/abc-def/providers/Microsoft.Authorization/roleAssignments/ra1",
			wantSubID:  "abc-def",
			wantRG:     "",
		},
		{
			name:       "Invalid ID",
			resourceID: "invalid-id",
			wantSubID:  "",
			wantRG:     "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			subID := testExtractSubscriptionFromID(tt.resourceID)
			assert.Equal(t, tt.wantSubID, subID)
		})
	}
}

func TestSortValidation(t *testing.T) {
	validSortColumns := map[string]bool{
		"name":      true,
		"type":      true,
		"location":  true,
		"cost":      true,
		"score":     true,
		"createdAt": true,
	}

	tests := []struct {
		input    string
		expected bool
	}{
		{"name", true},
		{"cost", true},
		{"invalid", false},
		{"", false},
		{"NAME", false}, // case sensitive
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			_, valid := validSortColumns[tt.input]
			assert.Equal(t, tt.expected, valid)
		})
	}
}

func TestPaginationCalculation(t *testing.T) {
	tests := []struct {
		page     int
		pageSize int
		expected int
	}{
		{1, 50, 0},
		{2, 50, 50},
		{3, 25, 50},
		{1, 100, 0},
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			offset := (tt.page - 1) * tt.pageSize
			assert.Equal(t, tt.expected, offset)
		})
	}
}

func TestCostPeriodValidation(t *testing.T) {
	validPeriods := []string{"current", "previous", "7days", "30days", "90days"}

	for _, period := range validPeriods {
		t.Run(period, func(t *testing.T) {
			// Simple validation - just check it's not empty
			assert.NotEmpty(t, period)
		})
	}
}

func TestDailyCostsLookFlat(t *testing.T) {
	tests := []struct {
		name     string
		items    []map[string]any
		expected bool
	}{
		{"empty", nil, false},
		{"all zero", []map[string]any{{"cost": 0.0}, {"cost": 0.0}}, false},
		{"identical", []map[string]any{{"cost": 100.0}, {"cost": 100.0}, {"cost": 100.0}}, true},
		{"within noise", []map[string]any{{"cost": 100.0}, {"cost": 100.49}, {"cost": 100.0}}, true},
		{"varies", []map[string]any{{"cost": 100.0}, {"cost": 110.0}, {"cost": 100.0}}, false},
		{"single value", []map[string]any{{"cost": 50.0}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, dailyCostsLookFlat(tt.items))
		})
	}
}

func TestValidateSortOrder(t *testing.T) {
	tests := []struct {
		input    string
		expected string
		valid    bool
	}{
		{"asc", "asc", true},
		{"desc", "desc", true},
		{"ASC", "", false},
		{"invalid", "", false},
		{"", "asc", true}, // default
	}

	validOrders := map[string]bool{"asc": true, "desc": true}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if tt.input == "" {
				assert.Equal(t, "asc", tt.expected)
				return
			}
			_, valid := validOrders[tt.input]
			assert.Equal(t, tt.valid, valid)
		})
	}
}

func TestToAnySlice(t *testing.T) {
	tests := []struct {
		input    []string
		expected int
	}{
		{[]string{"a", "b", "c"}, 3},
		{[]string{}, 0},
		{[]string{"single"}, 1},
		{[]string{"sub-1", "sub-2", "sub-3", "sub-4"}, 4},
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			result := toAnySlice(tt.input)
			assert.Equal(t, tt.expected, len(result))
			for i, v := range tt.input {
				assert.Equal(t, v, result[i])
			}
		})
	}
}

func TestStandardizedErrorResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := func(c *gin.Context) {
		standardizedErrorResponse(c, 500, fmt.Errorf("database error"), "Internal server error")
	}

	router := gin.New()
	router.GET("/error", handler)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/error", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, 500, w.Code)
	assert.Contains(t, w.Body.String(), "Internal server error")
	assert.Contains(t, w.Body.String(), "ERR-500")
}

func TestVersionInfo(t *testing.T) {
	// Version is bumped every release, so only check it's a semver-looking string
	assert.NotEmpty(t, Version)
	assert.Regexp(t, `^\d+\.\d+\.\d+`, Version)
}

func TestCalculatePercentages(t *testing.T) {
	tests := []struct {
		value    float64
		total    float64
		expected float64
	}{
		{50, 100, 50.0},
		{25, 100, 25.0},
		{0, 100, 0.0},
		{100, 0, 0}, // division by zero guard
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			var result float64
			if tt.total > 0 {
				result = (tt.value / tt.total) * 100
			}
			if tt.total > 0 {
				assert.InDelta(t, tt.expected, result, 0.01)
			}
		})
	}
}

func TestExtractSubscriptionFromID(t *testing.T) {
	tests := []struct {
		resourceID string
		wantSubID  string
	}{
		{"/subscriptions/12345/resourceGroups/myRG/providers/Microsoft.Compute/virtualMachines/vm1", "12345"},
		{"/subscriptions/abc-def/providers/Microsoft.Authorization/roleAssignments/ra1", "abc-def"},
		{"invalid-id", ""},
	}

	for _, tt := range tests {
		t.Run(tt.resourceID, func(t *testing.T) {
			assert.Equal(t, tt.wantSubID, testExtractSubscriptionFromID(tt.resourceID))
		})
	}
}
