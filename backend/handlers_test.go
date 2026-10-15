package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/costmanagement/armcostmanagement"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupRouterTest points the globals the handlers use at a test database with a small
// inventory and cached subscriptions, and returns the real router.
func setupRouterTest(t *testing.T) http.Handler {
	t.Helper()
	testCache, cleanup := setupTestDB(t)
	origCache := cache
	cache = testCache

	inv := testInventory()
	for i := range inv {
		inv[i].SubscriptionName = "Sub " + inv[i].SubscriptionID
	}
	publishInventory(inv, time.Now())

	activeSubsMu.Lock()
	origSubs, origAt := activeSubsCache, activeSubsFetchedAt
	activeSubsCache = []Subscription{{ID: "s1", Name: "Sub s1", State: "Enabled"}, {ID: "s2", Name: "Sub s2", State: "Enabled"}, {ID: "s3", Name: "Old", State: "Disabled"}}
	activeSubsFetchedAt = time.Now()
	activeSubsMu.Unlock()

	t.Cleanup(func() {
		cache = origCache
		publishInventory(nil, time.Time{})
		activeSubsMu.Lock()
		activeSubsCache, activeSubsFetchedAt = origSubs, origAt
		activeSubsMu.Unlock()
		cleanup()
	})
	return newRouter()
}

func getJSON(t *testing.T, h http.Handler, path string, out any) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Host = "localhost:8080"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if out != nil && w.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), out), w.Body.String())
	}
	return w.Code
}

func TestHandlerResources(t *testing.T) {
	h := setupRouterTest(t)
	cols := []string{"Cost", "ResourceId", "ResourceGroup", "ResourceType", "ResourceLocation"}
	var columns []*armcostmanagement.QueryColumn
	for _, c := range cols {
		name := c
		columns = append(columns, &armcostmanagement.QueryColumn{Name: &name})
	}
	inv := testInventory()
	cache.set("s1", "current", armcostmanagement.QueryResult{Properties: &armcostmanagement.QueryProperties{
		Columns: columns,
		Rows: [][]any{
			{10.0, inv[0].ID, "rg-a", "microsoft.compute/disks", "westeurope"},
			{4.0, "/subscriptions/s1/resourceGroups/gone/providers/Microsoft.Compute/disks/deleted", "gone", "microsoft.compute/disks", "westeurope"},
		},
	}})

	var all struct {
		Data            []AzureResource `json:"data"`
		Total           int             `json:"total"`
		TotalCost       float64         `json:"totalCost"`
		UnallocatedCost *float64        `json:"unallocatedCost"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/resources", &all))
	assert.Equal(t, 3, all.Total)
	assert.Equal(t, 10.0, all.TotalCost)
	require.NotNil(t, all.UnallocatedCost)
	assert.Equal(t, 4.0, *all.UnallocatedCost, "cost of a resource that no longer exists")

	var filtered struct {
		Total           int      `json:"total"`
		UnallocatedCost *float64 `json:"unallocatedCost"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/resources?search=nic", &filtered))
	assert.Equal(t, 1, filtered.Total)
	assert.Nil(t, filtered.UnallocatedCost, "not reported when filters hide resources")

	var orphans struct {
		Total int `json:"total"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/resources?orphaned=true", &orphans))
	assert.Equal(t, 1, orphans.Total)
}

func TestHandlerFiltersIncludeDisabledSubscriptions(t *testing.T) {
	h := setupRouterTest(t)
	var f struct {
		Subs []map[string]string `json:"subs"`
		RGs  []string            `json:"rgs"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/filters", &f))
	assert.Len(t, f.Subs, 3)
	assert.Equal(t, "Disabled", f.Subs[2]["state"])
	assert.ElementsMatch(t, []string{"RG-A", "rg-a", "rg-b"}, f.RGs)

	var active struct {
		Subscriptions []Subscription `json:"subscriptions"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/subscriptions", &active))
	assert.Len(t, active.Subscriptions, 2, "disabled subscriptions only with includeDisabled")
}

func TestHandlerComparisonCoverage(t *testing.T) {
	h := setupRouterTest(t)
	now := time.Now().UTC()
	day := func(d int) string { return now.AddDate(0, 0, -d).Format("2006-01-02") }
	// s1 has 90 days of history; s2 only 7, so its previous period is unknown.
	cache.setDailyCostsForWindow("s1", now.AddDate(0, 0, -90), []map[string]any{{"date": day(1), "cost": 30.0}, {"date": day(40), "cost": 10.0}})
	cache.setDailyCostsForWindow("s2", now.AddDate(0, 0, -7), []map[string]any{{"date": day(1), "cost": 500.0}})

	var cmp struct {
		CurrentPeriod  struct{ TotalCost float64 } `json:"currentPeriod"`
		PreviousPeriod struct{ TotalCost float64 } `json:"previousPeriod"`
		Coverage       struct {
			Subscriptions        int      `json:"subscriptions"`
			CoveredSubscriptions int      `json:"coveredSubscriptions"`
			CoveredIDs           []string `json:"coveredIds"`
		} `json:"coverage"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/costs/comparison?subscriptionId=s1&subscriptionId=s2&days=30", &cmp))
	assert.Equal(t, 2, cmp.Coverage.Subscriptions)
	assert.Equal(t, []string{"s1"}, cmp.Coverage.CoveredIDs)
	assert.Equal(t, 30.0, cmp.CurrentPeriod.TotalCost, "s2 is left out of both periods")
	assert.Equal(t, 10.0, cmp.PreviousPeriod.TotalCost)
}

func TestHandlerDailyCostsServesStaleRows(t *testing.T) {
	h := setupRouterTest(t)
	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	// Two different amounts: identical days look "flat" and are held back for a refresh.
	cache.setDailyCosts("s1", []map[string]any{{"date": yesterday, "cost": 20.0}, {"date": today, "cost": 25.0}})
	_, err := cache.db.Exec("UPDATE cost_daily SET fetched_at = ?", time.Now().Add(-72*time.Hour))
	require.NoError(t, err)

	var days []struct {
		Date string  `json:"date"`
		Cost float64 `json:"cost"`
	}
	require.Equal(t, 200, getJSON(t, h, "/api/costs/daily?subscriptionId=s1&period=7", &days))
	require.Len(t, days, 7)
	assert.Equal(t, today, days[6].Date)
	assert.Equal(t, 25.0, days[6].Cost, "72h-old rows are still shown")
}

func TestHandlerRejectsForeignHost(t *testing.T) {
	h := setupRouterTest(t)
	req := httptest.NewRequest(http.MethodGet, "/api/resources", nil)
	req.Host = "attacker.example:8080"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}
