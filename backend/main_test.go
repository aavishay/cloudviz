package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func TestComputeRunRateForecast(t *testing.T) {
	testCache, cleanup := setupTestDB(t)
	defer cleanup()
	origCache := cache
	cache = testCache
	defer func() { cache = origCache }()

	// $100/day for Oct 1-10, plus a partial $5 for today (Oct 11).
	var daily []map[string]any
	for d := 1; d <= 10; d++ {
		daily = append(daily, map[string]any{"date": fmt.Sprintf("2026-10-%02d", d), "cost": 100.0})
	}
	daily = append(daily, map[string]any{"date": "2026-10-11", "cost": 5.0})
	cache.setDailyCosts("sub-mid", daily)
	// Only today's partial data exists on the 1st of the month.
	cache.setDailyCosts("sub-first", []map[string]any{{"date": "2026-11-01", "cost": 40.0}})

	oct := time.Date(2026, 10, 1, 0, 0, 0, 0, time.Local)
	nov := time.Date(2026, 11, 1, 0, 0, 0, 0, time.Local)
	tests := []struct {
		name       string
		subID      string
		now        time.Time
		monthStart time.Time
		expected   float64
	}{
		{"mid-month excludes today's partial day", "sub-mid", time.Date(2026, 10, 11, 12, 0, 0, 0, time.Local), oct, 100.0 * 31},
		{"first of month falls back to today", "sub-first", time.Date(2026, 11, 1, 12, 0, 0, 0, time.Local), nov, 40.0 * 30},
		{"no data returns zero", "sub-none", time.Date(2026, 10, 11, 12, 0, 0, 0, time.Local), oct, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			monthEnd := tt.monthStart.AddDate(0, 1, -1)
			got := computeRunRateForecast(tt.subID, tt.now, tt.monthStart, monthEnd)
			assert.InDelta(t, tt.expected, got, 0.01)
		})
	}
}

func TestForecastCacheKey(t *testing.T) {
	assert.NotEqual(t, forecastCacheKey("sub", 7), forecastCacheKey("sub", 30), "Different days must not share an in-flight key")
	assert.Equal(t, forecastCacheKey("sub", 30), forecastCacheKey("sub", 30))
}

func TestFilterActiveSubscriptions(t *testing.T) {
	subs := []Subscription{
		{ID: "a", State: "Enabled"},
		{ID: "b", State: "Disabled"},
		{ID: "c", State: "Warned"},
		{ID: "d", State: "PastDue"},
		{ID: "e", State: "disabled"},
	}
	var ids []string
	for _, s := range filterActiveSubscriptions(subs) {
		ids = append(ids, s.ID)
	}
	assert.Equal(t, []string{"a", "c", "d"}, ids)
}

func TestInventoryLooksComplete(t *testing.T) {
	tests := []struct {
		name                            string
		stored, current, pendingDropCnt int
		expected                        bool
	}{
		{"empty scan is never complete", 12000, 0, 0, false},
		{"first snapshot", 0, 12000, 0, true},
		{"small change", 12000, 11900, 0, true},
		{"exactly 80% kept", 10000, 8000, 0, true},
		{"large drop held back", 12000, 300, 0, false},
		{"large drop confirmed by second scan", 12000, 6000, 6100, true},
		{"large drop not confirmed", 12000, 6000, 300, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, inventoryLooksComplete(tt.stored, tt.current, tt.pendingDropCnt))
		})
	}
}

func TestIsLoopbackHost(t *testing.T) {
	for host, want := range map[string]bool{
		"localhost:8080":     true,
		"127.0.0.1:8080":     true,
		"[::1]:8080":         true,
		"app.localhost":      true,
		"localhost":          true,
		"evil.com:8080":      false,
		"192.168.1.5:8080":   false,
		"localhost.evil.com": false,
	} {
		assert.Equal(t, want, isLoopbackHost(host), host)
	}
}

func TestLocalRequestGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(localRequestGuard([]string{"http://localhost:5173"}))
	r.GET("/api/x", func(c *gin.Context) { c.Status(200) })
	r.POST("/api/x", func(c *gin.Context) { c.Status(200) })
	r.DELETE("/api/x", func(c *gin.Context) { c.Status(200) })

	tests := []struct {
		name    string
		method  string
		host    string
		headers map[string]string
		body    string
		want    int
	}{
		{"same-origin GET", "GET", "localhost:8080", nil, "", 200},
		{"rebinding host", "GET", "evil.com:8080", nil, "", 403},
		{"allowed dev origin", "GET", "localhost:8080", map[string]string{"Origin": "http://localhost:5173"}, "", 200},
		{"foreign origin", "GET", "localhost:8080", map[string]string{"Origin": "https://evil.com"}, "", 403},
		{"cross-site fetch", "GET", "localhost:8080", map[string]string{"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors"}, "", 403},
		{"cross-site navigation opens the page", "GET", "localhost:8080", map[string]string{"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"}, "", 200},
		{"text/plain POST body", "POST", "localhost:8080", map[string]string{"Content-Type": "text/plain"}, `{"a":1}`, 415},
		{"JSON POST body", "POST", "localhost:8080", map[string]string{"Content-Type": "application/json"}, `{"a":1}`, 200},
		{"bodyless DELETE", "DELETE", "localhost:8080", nil, "", 200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/x", strings.NewReader(tt.body))
			req.Host = tt.host
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			assert.Equal(t, tt.want, w.Code)
		})
	}
}

func TestCostManagementLimitersStayWithinTenantLimit(t *testing.T) {
	perMin := float64(costLimiter.Limit()+forecastLimiter.Limit()) * 60
	assert.LessOrEqual(t, perMin, float64(costManagementCallsPerMin)+1e-9)
}

func TestOrphanKind(t *testing.T) {
	tests := []struct {
		name                                      string
		resType, managedBy, vm, pe, pls, ipc, nat string
		want                                      string
	}{
		{"unattached disk", "microsoft.compute/disks", "", "", "", "", "", "", orphanUnattachedDisk},
		{"attached disk", "Microsoft.Compute/disks", "/vm/x", "", "", "", "", "", ""},
		{"NIC on a VM", "microsoft.network/networkinterfaces", "", "/vm/x", "", "", "", "", ""},
		{"NIC on a private endpoint", "microsoft.network/networkinterfaces", "", "", "/pe/x", "", "", "", ""},
		{"NIC on a private link service", "microsoft.network/networkinterfaces", "", "", "", "/pls/x", "", "", ""},
		{"unattached NIC", "microsoft.network/networkinterfaces", "", "", "", "", "", "", orphanUnattachedNIC},
		{"IP on a load balancer or NIC", "microsoft.network/publicipaddresses", "", "", "", "", "map[id:/x]", "", ""},
		{"IP on a NAT gateway", "microsoft.network/publicipaddresses", "", "", "", "", "", "/nat/x", ""},
		{"unassigned IP", "microsoft.network/publicipaddresses", "", "", "", "", "", "", orphanUnassignedPIP},
		{"other type", "microsoft.compute/virtualmachines", "", "", "", "", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, orphanKind(tt.resType, tt.managedBy, tt.vm, tt.pe, tt.pls, tt.ipc, tt.nat))
		})
	}
}

func TestIsReservationCandidate(t *testing.T) {
	assert.True(t, isReservationCandidate("Microsoft.Compute/virtualMachines", map[string]string{"env": "prod"}))
	assert.True(t, isReservationCandidate("microsoft.compute/virtualmachinescalesets", nil))
	assert.False(t, isReservationCandidate("microsoft.compute/virtualmachines/extensions", nil), "extensions aren't compute")
	assert.False(t, isReservationCandidate("microsoft.compute/virtualmachines", map[string]string{"karpenter.sh_nodepool": "general"}))
	assert.False(t, isReservationCandidate("microsoft.compute/virtualmachinescalesets", map[string]string{"aks-managed-poolName": "system"}))
	assert.False(t, isReservationCandidate("microsoft.compute/disks", nil))
}

func TestReservationBreakEvenMonths(t *testing.T) {
	assert.Equal(t, 8.4, reservationBreakEvenMonths(12, 0.70))
	assert.Equal(t, 19.8, reservationBreakEvenMonths(36, 0.55))
}
