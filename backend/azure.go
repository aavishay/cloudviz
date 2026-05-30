package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/to"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/costmanagement/armcostmanagement"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/monitor/armmonitor"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/resourcegraph/armresourcegraph"
	"golang.org/x/time/rate"
)

// metricsClients caches MetricsClient per subscription to avoid recreating them
var metricsClients sync.Map // map[string]*armmonitor.MetricsClient

// objectIDCache caches Graph API lookups: objectID -> display name
var objectIDCache sync.Map

// subscriptionNameCache caches subscription ID -> subscription name
var subscriptionNameCache sync.Map

// isUUID returns true if s looks like a UUID (8-4-4-4-12 hex digits).
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// resolveObjectIDToName looks up an Azure AD / Entra object ID via Microsoft Graph
// and returns a human-readable display name. Falls back to the raw ID on any error.
func resolveObjectIDToName(ctx context.Context, objectID string) string {
	if v, ok := objectIDCache.Load(objectID); ok {
		return v.(string)
	}

	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return objectID
	}
	token, err := cred.GetToken(ctx, policy.TokenRequestOptions{
		Scopes: []string{"https://graph.microsoft.com/.default"},
	})
	if err != nil {
		objectIDCache.Store(objectID, objectID)
		return objectID
	}

	reqURL := "https://graph.microsoft.com/v1.0/directoryObjects/" + objectID
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return objectID
	}
	req.Header.Set("Authorization", "Bearer "+token.Token)

	httpClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return objectID
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		objectIDCache.Store(objectID, objectID)
		return objectID
	}

	var obj struct {
		DisplayName       string `json:"displayName"`
		UserPrincipalName string `json:"userPrincipalName"`
		AppDisplayName    string `json:"appDisplayName"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&obj); err != nil {
		return objectID
	}

	name := obj.DisplayName
	if obj.UserPrincipalName != "" {
		name = obj.UserPrincipalName
	} else if obj.AppDisplayName != "" {
		name = obj.AppDisplayName
	}
	if name == "" {
		name = objectID
	}

	objectIDCache.Store(objectID, name)
	return name
}

// resolveChangedByBatch resolves any GUID-style changedBy values to display names.
// It collects unique GUIDs, resolves them concurrently, then patches the slice.
func resolveChangedByBatch(ctx context.Context, items []string) []string {
	// Collect unique GUIDs
	unique := map[string]struct{}{}
	for _, v := range items {
		if isUUID(v) {
			unique[v] = struct{}{}
		}
	}
	if len(unique) == 0 {
		return items
	}

	// Resolve concurrently (Graph API caches after first hit)
	resolved := sync.Map{}
	var wg sync.WaitGroup
	for id := range unique {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			resolved.Store(id, resolveObjectIDToName(ctx, id))
		}(id)
	}
	wg.Wait()

	out := make([]string, len(items))
	for i, v := range items {
		if isUUID(v) {
			if name, ok := resolved.Load(v); ok {
				out[i] = name.(string)
				continue
			}
		}
		out[i] = v
	}
	return out
}

// subCostLimiters ensures only one cost API request per subscription is in flight at a time
var subCostLimiters sync.Map // map[string]*rate.Limiter

// Global 429 cooldown: when any request hits 429, all requests pause for 30s
var (
	last429Mu   sync.Mutex
	last429Time time.Time
)

func record429() {
	last429Mu.Lock()
	last429Time = time.Now()
	last429Mu.Unlock()
}

func cooldownWait(ctx context.Context) error {
	last429Mu.Lock()
	t := last429Time
	last429Mu.Unlock()

	if time.Since(t) < 1*time.Second {
		wait := 1*time.Second - time.Since(t)
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

// extractSubID parses the subscription ID from a log context string.
// Handles formats like "<uuid>", "<uuid>/current", "forecast <uuid>".
func extractSubID(logCtx string) string {
	s := logCtx
	if idx := strings.Index(s, " "); idx != -1 {
		s = s[idx+1:]
	}
	if idx := strings.Index(s, "/"); idx != -1 {
		s = s[:idx]
	}
	return s
}

// Utility functions for code reuse

// truncateString truncates a string to maxLen, adding "..." if truncated
func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}

// parseFloatVal converts various types to float64
func parseFloatVal(v any) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case string:
		if val == "" {
			return 0
		}
		f, err := strconv.ParseFloat(val, 64)
		if err != nil {
			return math.NaN()
		}
		return f
	default:
		return 0
	}
}

// parseAzureDate converts Azure date format (yyyyMMdd) to yyyy-MM-dd
func parseAzureDate(dateVal string) string {
	dateStr := strings.TrimSpace(dateVal)
	if len(dateStr) == 8 {
		return fmt.Sprintf("%s-%s-%s", dateStr[0:4], dateStr[4:6], dateStr[6:8])
	}
	// Handle numeric values that may come as scientific notation (e.g. 2.0260401e+07)
	var dateNum float64
	if _, err := fmt.Sscanf(dateStr, "%e", &dateNum); err == nil {
		dateStr = fmt.Sprintf("%.0f", dateNum)
		if len(dateStr) == 8 {
			return fmt.Sprintf("%s-%s-%s", dateStr[0:4], dateStr[4:6], dateStr[6:8])
		}
	}
	return dateStr
}

// getResourceTypeName extracts the resource type name from a full type string
func getResourceTypeName(fullType string) string {
	parts := strings.Split(fullType, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return fullType
}

// getMetricsClient returns a cached MetricsClient for the subscription
func getMetricsClient(subID string) (*armmonitor.MetricsClient, error) {
	if client, ok := metricsClients.Load(subID); ok {
		return client.(*armmonitor.MetricsClient), nil
	}

	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, err
	}

	client, err := armmonitor.NewMetricsClient(subID, cred, nil)
	if err != nil {
		return nil, err
	}

	metricsClients.Store(subID, client)
	return client, nil
}

// retryAfter429 calls fn with up to 4 retries. On 429 responses it backs off
// exponentially starting at 10s (10s, 20s, 40s, 80s), capped at 80s, with jitter.
func retryAfter429[T any](ctx context.Context, logCtx string, fn func() (T, error)) (T, error) {
	var zero T

	// Per-subscription rate limiter: Azure allows ~10 req/s per subscription
	// Use 5 req/s with burst of 3 to handle consecutive calls gracefully
	subID := extractSubID(logCtx)
	if subID != "" {
		var lim *rate.Limiter
		if l, ok := subCostLimiters.Load(subID); ok {
			lim = l.(*rate.Limiter)
		} else {
			lim = rate.NewLimiter(rate.Limit(10), 5)
			if actual, loaded := subCostLimiters.LoadOrStore(subID, lim); loaded {
				lim = actual.(*rate.Limiter)
			}
		}
		if err := lim.Wait(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("Per-sub rate limiter error for %s: %v", logCtx, err)
		}
	}

	for retry := 0; retry < 4; retry++ {
		if err := cooldownWait(ctx); err != nil {
			return zero, err
		}
		if err := costLimiter.Wait(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("Rate limiter error for %s: %v", logCtx, err)
		}

		result, err := fn()
		if err == nil {
			return result, nil
		}

		if strings.Contains(err.Error(), "429") {
			record429()
			waitSecs := 10 * (1 << retry)
			if waitSecs > 80 {
				waitSecs = 80
			}
			// Add 0-5s jitter to prevent thundering herd on retry
			waitSecs += rand.Intn(5)
			log.Printf("Rate limit (429) hit for %s, retry %d in %ds", logCtx, retry, waitSecs)
			select {
			case <-time.After(time.Duration(waitSecs) * time.Second):
			case <-ctx.Done():
				log.Printf("Context cancelled for %s, stopping retries", logCtx)
				return zero, ctx.Err()
			}
			continue
		}
		return zero, err
	}
	return zero, fmt.Errorf("max retries exceeded for %s", logCtx)
}

func fetchSubCostsSync(client *armcostmanagement.QueryClient, sid string, period CostPeriod, start time.Time, ctx context.Context) (*armcostmanagement.QueryClientUsageResponse, error) {
	scope := "subscriptions/" + sid

	now := time.Now()
	end := now
	if period == CostPeriodPrevious {
		end = now.AddDate(0, 0, -30)
	}

	props := armcostmanagement.QueryDefinition{
		Type: to.Ptr(armcostmanagement.ExportTypeAmortizedCost),
		Dataset: &armcostmanagement.QueryDataset{
			Aggregation: map[string]*armcostmanagement.QueryAggregation{
				"totalCost": {Name: to.Ptr("PreTaxCost"), Function: to.Ptr(armcostmanagement.FunctionTypeSum)},
			},
			Grouping: []*armcostmanagement.QueryGrouping{
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceId")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceGroup")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceType")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceLocation")},
			},
		},
		Timeframe:  to.Ptr(armcostmanagement.TimeframeTypeCustom),
		TimePeriod: &armcostmanagement.QueryTimePeriod{From: to.Ptr(start), To: to.Ptr(end)},
	}

	logCtx := fmt.Sprintf("%s/%s", sid, period)
	res, err := retryAfter429(ctx, logCtx, func() (armcostmanagement.QueryClientUsageResponse, error) {
		return client.Usage(ctx, scope, props, nil)
	})
	if err != nil {
		return nil, err
	}
	cache.set(sid, string(period), res.QueryResult)
	return &res, nil
}

// fetchDailyCosts queries Azure Cost Management grouped by date for daily trend data
func fetchDailyCosts(client *armcostmanagement.QueryClient, sid string, start, end time.Time, ctx context.Context) ([]map[string]any, error) {
	scope := "subscriptions/" + sid
	props := armcostmanagement.QueryDefinition{
		Type: to.Ptr(armcostmanagement.ExportTypeActualCost),
		Dataset: &armcostmanagement.QueryDataset{
			Aggregation: map[string]*armcostmanagement.QueryAggregation{
				"totalCost": {Name: to.Ptr("PreTaxCost"), Function: to.Ptr(armcostmanagement.FunctionTypeSum)},
			},
			Granularity: to.Ptr(armcostmanagement.GranularityTypeDaily),
		},
		Timeframe:  to.Ptr(armcostmanagement.TimeframeTypeCustom),
		TimePeriod: &armcostmanagement.QueryTimePeriod{From: to.Ptr(start), To: to.Ptr(end)},
	}

	return retryAfter429(ctx, sid, func() ([]map[string]any, error) {
		res, err := client.Usage(ctx, scope, props, nil)
		if err != nil {
			return nil, err
		}
		return parseDailyCostResults(res.QueryResult), nil
	})
}

func parseDailyCostResults(res armcostmanagement.QueryResult) []map[string]any {
	if res.Properties == nil || res.Properties.Rows == nil {
		return nil
	}

	var results []map[string]any
	colCost, colDate := -1, -1

	if res.Properties.Columns != nil {
		// Log available columns for debugging
		var colNames []string
		for i, col := range res.Properties.Columns {
			if col.Name == nil {
				continue
			}
			colNames = append(colNames, *col.Name)
			name := strings.ToLower(*col.Name)
			// Check for date column (various Azure naming conventions)
			if strings.Contains(name, "date") || strings.Contains(name, "usage") {
				colDate = i
			}
			// Check for cost column
			if strings.Contains(name, "cost") || strings.Contains(name, "pretax") {
				colCost = i
			}
		}
		log.Printf("Daily cost columns: %v, detected costIdx=%d, dateIdx=%d", colNames, colCost, colDate)
	}

	// Validate column indices
	if colCost < 0 || colDate < 0 {
		log.Printf("Warning: Could not detect cost/date columns, returning empty results")
		return nil
	}

	rowCount := len(res.Properties.Rows)
	if rowCount == 0 {
		return nil
	}

	for i, row := range res.Properties.Rows {
		if len(row) <= colCost || len(row) <= colDate {
			log.Printf("Warning: Row %d has insufficient columns (len=%d, need cost=%d, date=%d)", i, len(row), colCost, colDate)
			continue
		}
		dateVal := fmt.Sprintf("%v", row[colDate])
		costVal := row[colCost]
		parsedCost := parseFloatVal(costVal)
		if i < 3 {
			log.Printf("Row %d: dateRaw=%v, costRaw=%v, parsedCost=%.4f", i, dateVal, costVal, parsedCost)
		}
		results = append(results, map[string]any{
			"date": parseAzureDate(dateVal),
			"cost": parsedCost,
		})
	}
	log.Printf("Parsed %d daily cost rows", len(results))
	return results
}

func quoteAll(ss []string) []string {
	quoted := make([]string, len(ss))
	for i, s := range ss {
		quoted[i] = fmt.Sprintf("'%s'", s)
	}
	return quoted
}

func placeholders(n int) string {
	ps := make([]string, n)
	for i := range ps {
		ps[i] = "?"
	}
	return strings.Join(ps, ",")
}

// DiscoverSubscriptions queries Azure Resource Graph for all subscriptions the user has access to.
// Returns subscriptions that are Enabled, Warned, or PastDue (excludes Disabled and Deleted).
func DiscoverSubscriptions(ctx context.Context) ([]Subscription, error) {
	query := `resourcecontainers
		| where type == "microsoft.resources/subscriptions"
		| where properties.state in ("Enabled", "Warned", "PastDue")
		| project id, name, state=properties.state, tenantId=tenantId, tags`

	request := armresourcegraph.QueryRequest{
		Query: to.Ptr(query),
		Options: &armresourcegraph.QueryRequestOptions{
			ResultFormat: to.Ptr(armresourcegraph.ResultFormatObjectArray),
			Top:          to.Ptr(int32(1000)),
		},
	}

	results, err := argClient.Resources(ctx, request, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to query subscriptions: %w", err)
	}

	var subscriptions []Subscription
	rows, _ := results.Data.([]interface{})

	for _, row := range rows {
		m, ok := row.(map[string]interface{})
		if !ok {
			continue
		}

		// Extract ID and remove leading "/subscriptions/" if present
		id := safeStr(m["id"])
		if idx := strings.LastIndex(id, "/"); idx >= 0 {
			id = id[idx+1:]
		}

		// Parse tags
		tags := make(map[string]string)
		if t, ok := m["tags"].(map[string]interface{}); ok {
			for k, v := range t {
				tags[k] = safeStr(v)
			}
		}

		subscriptions = append(subscriptions, Subscription{
			ID:       id,
			Name:     safeStr(m["name"]),
			State:    safeStr(m["state"]),
			TenantID: safeStr(m["tenantId"]),
			Tags:     tags,
		})
	}

	// Sort by name for consistent ordering
	sort.Slice(subscriptions, func(i, j int) bool {
		return subscriptions[i].Name < subscriptions[j].Name
	})

	return subscriptions, nil
}

// safeStr safely extracts a string value from an interface{}
func safeStr(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// FetchResourcesWithCosts encapsulates the logic to get resources from ARG and match them with costs from SQLite
func FetchResourcesWithCosts(ctx context.Context, subs, rgs, types, locs []string, search string, orphaned, unattachedDiskOnly, unassignedPIPOnly, unattachedNICOnly bool, tagKey, tagValue string) ([]AzureResource, float64, error) {
	var clauses []string
	if len(subs) > 0 {
		clauses = append(clauses, fmt.Sprintf("subscriptionId in~ (%s)", strings.Join(quoteAll(subs), ",")))
	}
	if len(rgs) > 0 {
		clauses = append(clauses, fmt.Sprintf("resourceGroup in~ (%s)", strings.Join(quoteAll(rgs), ",")))
	}
	if len(types) > 0 {
		clauses = append(clauses, fmt.Sprintf("type in~ (%s)", strings.Join(quoteAll(types), ",")))
	}
	if len(locs) > 0 {
		clauses = append(clauses, fmt.Sprintf("location in~ (%s)", strings.Join(quoteAll(locs), ",")))
	}
	if search != "" {
		clauses = append(clauses, fmt.Sprintf("name contains '%s' or resourceGroup contains '%s' or type contains '%s'", search, search, search))
	}
	if tagKey != "" && tagValue != "" {
		if tagValue == "Untagged" {
			clauses = append(clauses, fmt.Sprintf("isempty(tags['%s']) or isnull(tags['%s'])", tagKey, tagKey))
		} else {
			clauses = append(clauses, fmt.Sprintf("tags['%s'] =~ '%s'", tagKey, tagValue))
		}
	}
	if orphaned {
		clauses = append(clauses, "((type has 'microsoft.compute/disks' and isnull(managedBy)) or (type has 'microsoft.network/networkinterfaces' and isnull(properties.virtualMachine)) or (type has 'microsoft.network/publicipaddresses' and isnull(properties.ipConfiguration)))")
	}
	if unattachedDiskOnly {
		clauses = append(clauses, "(type has 'microsoft.compute/disks' and isnull(managedBy))")
	}
	if unassignedPIPOnly {
		clauses = append(clauses, "(type has 'microsoft.network/publicipaddresses' and isnull(properties.ipConfiguration))")
	}
	if unattachedNICOnly {
		clauses = append(clauses, "(type has 'microsoft.network/networkinterfaces' and isnull(properties.virtualMachine))")
	}

	whereClause := ""
	if len(clauses) > 0 {
		whereClause = "| where " + strings.Join(clauses, " and ")
	}

	fullQuery := fmt.Sprintf("Resources %s | project id, name, type, location, subscriptionId, resourceGroup, tags, status=properties.provisioningState, managedBy, vmId=properties.virtualMachine.id, ipConfig=properties.ipConfiguration", whereClause)

	var allResources []AzureResource
	var skipToken *string

	for {
		request := armresourcegraph.QueryRequest{
			Query: to.Ptr(fullQuery),
			Options: &armresourcegraph.QueryRequestOptions{
				ResultFormat: to.Ptr(armresourcegraph.ResultFormatObjectArray),
				Top:          to.Ptr(int32(1000)),
				SkipToken:    skipToken,
			},
		}

		results, err := argClient.Resources(ctx, request, nil)
		if err != nil {
			return nil, 0, err
		}

		safeStr := func(v any) string {
			if v == nil {
				return ""
			}
			return fmt.Sprint(v)
		}

		rows, _ := results.Data.([]interface{})
		for _, row := range rows {
			m, _ := row.(map[string]interface{})
			tags := make(map[string]string)
			if t, ok := m["tags"].(map[string]interface{}); ok {
				for k, v := range t {
					tags[k] = safeStr(v)
				}
			}

			opt := ""
			score := 100
			resType := strings.ToLower(safeStr(m["type"]))
			resName := strings.ToLower(safeStr(m["name"]))

			if strings.Contains(resType, "virtualmachines") && (strings.Contains(resName, "dev") || strings.Contains(resName, "test")) {
				opt = "Dev Resource"
				score = 45
			} else if strings.Contains(resType, "virtualmachines") && strings.Contains(resType, "scalesets") {
				opt = "Scale-set"
				score = 75
			}

			isOrphaned := false
			if strings.Contains(resType, "microsoft.compute/disks") && safeStr(m["managedBy"]) == "" {
				isOrphaned = true
				opt = "Unattached Disk"
				score = 20
			} else if strings.Contains(resType, "microsoft.network/networkinterfaces") && safeStr(m["vmId"]) == "" {
				isOrphaned = true
				opt = "Unattached NIC"
				score = 25
			} else if strings.Contains(resType, "microsoft.network/publicipaddresses") && safeStr(m["ipConfig"]) == "" {
				isOrphaned = true
				opt = "Unassigned PIP"
				score = 30
			}

			// Extract creator information from tags or properties
			createdBy := extractCreatorFromTags(tags)
			createdByType := "user"
			if strings.Contains(createdBy, "@") {
				// It's an email, keep as is
			} else if createdBy != "" {
				// Check if it looks like a service principal
				if strings.Contains(strings.ToLower(createdBy), "spn") || strings.Contains(strings.ToLower(createdBy), "service") {
					createdByType = "service_principal"
				} else if strings.HasPrefix(createdBy, "mi-") || strings.Contains(strings.ToLower(createdBy), "managedidentity") {
					createdByType = "managed_identity"
				}
			}

			// Try to get creation time from tags or properties
			createdAt := time.Time{}
			if tStr := safeStr(m["createdTime"]); tStr != "" {
				if t, err := time.Parse(time.RFC3339, tStr); err == nil {
					createdAt = t
				}
			}

			allResources = append(allResources, AzureResource{
				ID:             safeStr(m["id"]),
				Name:           safeStr(m["name"]),
				Type:           safeStr(m["type"]),
				Location:       safeStr(m["location"]),
				SubscriptionID: safeStr(m["subscriptionId"]),
				ResourceGroup:  safeStr(m["resourceGroup"]),
				Status:         safeStr(m["status"]),
				Tags:           tags,
				Optimization:   opt,
				Score:          score,
				IsOrphaned:     isOrphaned,
				CreatedBy:      createdBy,
				CreatedByType:  createdByType,
				CreatedAt:      createdAt,
				ManagedBy:      safeStr(m["managedBy"]),
			})
		}

		if results.SkipToken == nil || *results.SkipToken == "" {
			break
		}
		skipToken = results.SkipToken
	}

	// Match costs
	uniqueSubs := make(map[string]bool)
	for _, r := range allResources {
		uniqueSubs[r.SubscriptionID] = true
	}

	totalCost := 0.0
	if len(allResources) > 0 {
		subList := []string{}
		for s := range uniqueSubs {
			subList = append(subList, s)
		}

		costRows, err := cache.db.Query("SELECT subscription_id, resource_id, resource_group, resource_type, resource_location, cost FROM costs WHERE subscription_id IN ("+placeholders(len(subList))+")", (func() []any {
			args := []any{}
			for _, s := range subList {
				args = append(args, s)
			}
			return args
		})()...)

		if err == nil {
			defer costRows.Close()
			costMapByID := make(map[string]float64)
			costMapByGroup := make(map[string]float64)

			for costRows.Next() {
				var s, rid, rg, rt, rl string
				var cost float64
				if err := costRows.Scan(&s, &rid, &rg, &rt, &rl, &cost); err == nil {
					if cost == 0 {
						continue
					}
					if rid != "" {
						costMapByID[strings.ToLower(rid)] += cost
					} else {
						key := strings.ToLower(fmt.Sprintf("%s|%s|%s|%s", s, rg, rt, normalizeLocation(rl)))
						costMapByGroup[key] += cost
					}
				}
			}

			groupCounts := make(map[string]int)
			for i := range allResources {
				r := &allResources[i]
				if costMapByID[strings.ToLower(r.ID)] == 0 {
					key := strings.ToLower(fmt.Sprintf("%s|%s|%s|%s", r.SubscriptionID, r.ResourceGroup, r.Type, normalizeLocation(r.Location)))
					groupCounts[key]++
				}
			}

			for i := range allResources {
				r := &allResources[i]
				r.Cost = costMapByID[strings.ToLower(r.ID)]
				if r.Cost == 0 {
					key := strings.ToLower(fmt.Sprintf("%s|%s|%s|%s", r.SubscriptionID, r.ResourceGroup, r.Type, normalizeLocation(r.Location)))
					if count := groupCounts[key]; count > 0 {
						r.Cost = costMapByGroup[key] / float64(count)
					}
				}
				totalCost += r.Cost
			}
		}
	}

	// Fetch subscription names and populate them in resources
	// Filter out resources from subscriptions that couldn't be resolved
	if len(allResources) > 0 {
		subList := make([]string, 0, len(uniqueSubs))
		for s := range uniqueSubs {
			subList = append(subList, s)
		}
		subNames := fetchSubscriptionNames(ctx, subList)

		// Filter resources to only include those with valid subscription names
		validResources := make([]AzureResource, 0, len(allResources))
		for _, r := range allResources {
			if name, ok := subNames[r.SubscriptionID]; ok {
				r.SubscriptionName = name
				validResources = append(validResources, r)
			} else {
				log.Printf("Filtering out resource %s from unknown subscription %s", r.Name, r.SubscriptionID)
			}
		}
		allResources = validResources
	}

	return allResources, totalCost, nil
}

func normalizeResults(res armcostmanagement.QueryResult) any {
	if res.Properties == nil || res.Properties.Rows == nil {
		return nil
	}

	colCost, colId, colRg, colType, colLoc := 0, -1, -1, -1, -1
	if res.Properties.Columns != nil {
		for i, col := range res.Properties.Columns {
			if col.Name == nil {
				continue
			}
			name := *col.Name
			if name == "PreTaxCost" || name == "Cost" {
				colCost = i
			}
			if name == "ResourceId" {
				colId = i
			}
			if name == "ResourceGroup" {
				colRg = i
			}
			if name == "ResourceType" {
				colType = i
			}
			if name == "ResourceLocation" || name == "Location" {
				colLoc = i
			}
		}
	}

	if colId == -1 {
		colId = 1
	}
	if colRg == -1 {
		colRg = 2
	}
	if colType == -1 {
		colType = 3
	}
	if colLoc == -1 {
		colLoc = 4
	}

	var items []any
	for _, row := range res.Properties.Rows {
		if len(row) < 5 {
			continue
		}

		getVal := func(idx int) string {
			if idx >= 0 && idx < len(row) {
				return fmt.Sprintf("%v", row[idx])
			}
			return ""
		}

		cost := row[colCost]
		rid := getVal(colId)
		rg := strings.ToLower(getVal(colRg))
		rt := strings.ToLower(getVal(colType))
		rl := normalizeLocation(getVal(colLoc))

		items = append(items, map[string]interface{}{
			"cost":             cost,
			"resourceId":       rid,
			"resourceGroup":    rg,
			"resourceType":     rt,
			"resourceLocation": rl,
		})
	}
	return items
}

// fetchDailyCostsByType queries Azure Cost Management grouped by date AND resource type
func fetchDailyCostsByType(client *armcostmanagement.QueryClient, sid string, start, end time.Time, ctx context.Context) ([]map[string]any, error) {
	scope := "subscriptions/" + sid
	props := armcostmanagement.QueryDefinition{
		Type: to.Ptr(armcostmanagement.ExportTypeActualCost),
		Dataset: &armcostmanagement.QueryDataset{
			Aggregation: map[string]*armcostmanagement.QueryAggregation{
				"totalCost": {Name: to.Ptr("PreTaxCost"), Function: to.Ptr(armcostmanagement.FunctionTypeSum)},
			},
			Grouping: []*armcostmanagement.QueryGrouping{
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceType")},
			},
			Granularity: to.Ptr(armcostmanagement.GranularityTypeDaily),
		},
		Timeframe:  to.Ptr(armcostmanagement.TimeframeTypeCustom),
		TimePeriod: &armcostmanagement.QueryTimePeriod{From: to.Ptr(start), To: to.Ptr(end)},
	}

	return retryAfter429(ctx, sid, func() ([]map[string]any, error) {
		res, err := client.Usage(ctx, scope, props, nil)
		if err != nil {
			return nil, err
		}
		return parseDailyCostsByType(res.QueryResult), nil
	})
}

func parseDailyCostsByType(res armcostmanagement.QueryResult) []map[string]any {
	if res.Properties == nil || res.Properties.Rows == nil {
		return nil
	}

	var results []map[string]any
	colCost, colDate, colType := -1, -1, -1

	if res.Properties.Columns != nil {
		for i, col := range res.Properties.Columns {
			if col.Name == nil {
				continue
			}
			name := strings.ToLower(*col.Name)
			if strings.Contains(name, "date") || strings.Contains(name, "usage") {
				colDate = i
			}
			if strings.Contains(name, "resourcetype") || strings.Contains(name, "type") {
				colType = i
			}
			if strings.Contains(name, "cost") || strings.Contains(name, "pretax") {
				colCost = i
			}
		}
	}

	// Validate column indices
	if colCost < 0 || colDate < 0 || colType < 0 {
		log.Printf("Warning: Could not detect columns (cost=%d, date=%d, type=%d)", colCost, colDate, colType)
		return nil
	}

	for _, row := range res.Properties.Rows {
		if len(row) <= colCost || len(row) <= colDate || len(row) <= colType {
			continue
		}
		dateVal := fmt.Sprintf("%v", row[colDate])
		typeVal := fmt.Sprintf("%v", row[colType])
		costVal := row[colCost]
		var cost float64
		switch v := costVal.(type) {
		case float64:
			cost = v
		case float32:
			cost = float64(v)
		case int64:
			cost = float64(v)
		default:
			if s, ok := costVal.(string); ok {
				fmt.Sscanf(s, "%f", &cost)
			}
		}
		// Parse date string - Azure returns yyyyMMdd or yyyy-MM-dd format
		// Handle numeric values that may come as scientific notation (e.g. 2.0260401e+07)
		dateStr := strings.TrimSpace(dateVal)
		if len(dateStr) != 8 {
			var dateNum float64
			if _, err := fmt.Sscanf(dateStr, "%e", &dateNum); err == nil {
				dateStr = fmt.Sprintf("%.0f", dateNum)
			}
		}
		if len(dateStr) == 8 { // yyyyMMdd
			year := dateStr[0:4]
			month := dateStr[4:6]
			day := dateStr[6:8]
			dateStr = fmt.Sprintf("%s-%s-%s", year, month, day)
		}
		// else: already yyyy-MM-dd from Date dimension, use as-is
		// Normalize resource type
		rt := strings.ToLower(typeVal)
		if idx := strings.LastIndex(rt, "/"); idx >= 0 {
			rt = rt[idx+1:]
		}
		results = append(results, map[string]any{
			"date":         dateStr,
			"resourceType": rt,
			"cost":         cost,
		})
	}
	return results
}

// fetchForecast queries Azure Cost Management for actual costs and AI-powered forecast
func fetchForecast(client *armcostmanagement.ForecastClient, sid string, start, end time.Time, ctx context.Context) (actualCost float64, forecastCost float64, err error) {
	scope := "subscriptions/" + sid
	props := armcostmanagement.ForecastDefinition{
		Type:       to.Ptr(armcostmanagement.ForecastTypeActualCost),
		Timeframe:  to.Ptr(armcostmanagement.ForecastTimeframeTypeCustom),
		TimePeriod: &armcostmanagement.QueryTimePeriod{From: to.Ptr(start), To: to.Ptr(end)},
		IncludeActualCost: to.Ptr(true),
		Dataset: &armcostmanagement.ForecastDataset{
			Granularity: to.Ptr(armcostmanagement.GranularityTypeDaily),
			Aggregation: map[string]*armcostmanagement.QueryAggregation{
				"totalCost": {Name: to.Ptr("PreTaxCost"), Function: to.Ptr(armcostmanagement.FunctionTypeSum)},
			},
		},
	}

	logCtx := fmt.Sprintf("forecast %s", sid)
	res, err := retryAfter429(ctx, logCtx, func() (armcostmanagement.ForecastClientUsageResponse, error) {
		return client.Usage(ctx, scope, props, nil)
	})
	if err != nil {
		return 0, 0, err
	}
	actualCost, forecastCost = parseForecastResults(res.QueryResult)
	return actualCost, forecastCost, nil
}

func parseForecastResults(res armcostmanagement.QueryResult) (actualCost, forecastCost float64) {
	if res.Properties == nil || res.Properties.Rows == nil {
		return 0, 0
	}

	// Map columns by name — Azure column order varies.
	// Known columns: PreTaxCost, UsageDate, CostStatus, Currency
	colCost, colStatus := -1, -1
	if res.Properties.Columns != nil {
		for i, col := range res.Properties.Columns {
			if col.Name == nil {
				continue
			}
			name := strings.ToLower(*col.Name)
			if name == "pretaxcost" || name == "cost" {
				colCost = i
			}
			if name == "coststatus" || name == "isforecast" || name == "status" {
				colStatus = i
			}
		}
	}
	// Fallback to known positions if names didn't match
	if colCost < 0 {
		colCost = 0
	}
	if colStatus < 0 {
		colStatus = 2
	}

	for _, row := range res.Properties.Rows {
		if len(row) <= colCost {
			continue
		}

		costVal := row[colCost]
		var cost float64
		switch v := costVal.(type) {
		case float64:
			cost = v
		case float32:
			cost = float64(v)
		case int64:
			cost = float64(v)
		default:
			if s, ok := costVal.(string); ok {
				fmt.Sscanf(s, "%f", &cost)
			}
		}

		isForecastRow := false
		if colStatus >= 0 && colStatus < len(row) {
			statusVal := fmt.Sprintf("%v", row[colStatus])
			isForecastRow = strings.EqualFold(statusVal, "forecast") ||
				strings.EqualFold(statusVal, "true") ||
				statusVal == "1"
		}

		if isForecastRow {
			forecastCost += cost
		} else {
			actualCost += cost
		}
	}
	return actualCost, forecastCost
}

func parseMetricsResponse(res armmonitor.MetricsClientListResponse) map[string][]float64 {
	metrics := make(map[string][]float64)
	for _, m := range res.Value {
		var values []float64
		for _, ts := range m.Timeseries {
			for _, data := range ts.Data {
				if data.Average != nil {
					values = append(values, *data.Average)
				}
			}
		}
		if len(values) > 0 {
			name := "Metric"
			if m.Name != nil && m.Name.Value != nil {
				name = *m.Name.Value
			}
			metrics[name] = values
		}
	}
	return metrics
}

func calculateMetricsStats(metrics map[string][]float64) MetricsSummary {
	summary := make(map[string]MetricStats)
	for name, values := range metrics {
		if len(values) == 0 {
			continue
		}
		sorted := make([]float64, len(values))
		copy(sorted, values)
		sort.Float64s(sorted)

		sum := 0.0
		for _, v := range values {
			sum += v
		}

		p95Index := int(math.Ceil(float64(len(sorted))*0.95)) - 1
		if p95Index < 0 {
			p95Index = 0
		}
		if p95Index >= len(sorted) {
			p95Index = len(sorted) - 1
		}

		summary[name] = MetricStats{
			Min:  sorted[0],
			Max:  sorted[len(sorted)-1],
			Avg:  sum / float64(len(values)),
			P95:  sorted[p95Index],
			Unit: detectUnit(name),
		}
	}
	return MetricsSummary{Metrics: summary}
}

func detectUnit(name string) string {
	lower := strings.ToLower(name)
	if strings.Contains(lower, "cpu") || strings.Contains(lower, "percent") {
		return "%"
	}
	if strings.Contains(lower, "bytes") || strings.Contains(lower, "capacity") {
		return "bytes"
	}
	if strings.Contains(lower, "request") || strings.Contains(lower, "count") {
		return "count"
	}
	return ""
}

// MetricConfig defines the metrics to fetch for a resource type
var metricConfigs = map[string]struct {
	metricNames string
	fallback    map[string][]float64
}{
	"microsoft.compute/virtualmachines": {
		metricNames: "Percentage CPU,Average_MemoryUsagePercentage,DataDiskReadBytesPerSecond,DataDiskWriteBytesPerSecond,OSDiskReadBytesPerSecond,OSDiskWriteBytesPerSecond,NetworkInTotal,NetworkOutTotal",
		fallback:    map[string][]float64{"Percentage CPU": {12, 15, 18, 14, 22, 19, 15}, "Average_MemoryUsagePercentage": {30, 35, 28, 40, 25, 33, 29}},
	},
	"microsoft.sql/servers/databases": {
		metricNames: "cpu_percent,dtu_consumption_percent,data_space_used_percent,sessions_count,workers_count",
		fallback:    map[string][]float64{"cpu_percent": {10, 15, 12, 18, 14, 20, 16}, "dtu_consumption_percent": {20, 25, 22, 28, 24, 30, 26}},
	},
	"microsoft.documentdb/databaseaccounts": {
		metricNames: "TotalRequestUnits,Requests,DocumentCount,ProvisionedThroughput,MongoRequestUnits",
		fallback:    map[string][]float64{"TotalRequestUnits": {100, 150, 120, 180, 140, 200, 160}, "Requests": {50, 75, 60, 90, 70, 100, 80}},
	},
	"microsoft.web/sites": {
		metricNames: "AverageResponseTime,Requests,HttpQueueLength,MemoryWorkingSet,BytesReceived,BytesSent",
		fallback:    map[string][]float64{"AverageResponseTime": {50, 80, 65, 100, 75, 120, 90}, "HttpQueueLength": {1, 2, 1, 3, 2, 4, 2}, "MemoryWorkingSet": {200, 250, 220, 300, 240, 320, 260}},
	},
	"microsoft.storage/storageaccounts": {
		metricNames: "UsedCapacity,Transactions,BlobCapacity,TableCapacity,QueueCapacity",
		fallback:    map[string][]float64{"UsedCapacity": {10000000000, 10500000000, 10200000000, 10800000000, 10400000000, 11000000000, 10600000000}, "Transactions": {1000, 1500, 1200, 1800, 1400, 2000, 1600}},
	},
	"microsoft.containerservice/managedclusters": {
		metricNames: "clusterCpuUtilization,nodeCpuUtilization_Mean,nodeMemoryUtilization_Mean,podsCount_Free",
		fallback:    map[string][]float64{"clusterCpuUtilization": {30, 35, 28, 40, 32, 45, 38}, "nodeMemoryUtilization_Mean": {50, 55, 48, 60, 52, 65, 58}},
	},
}

// fetchResourceMetrics fetches metrics for a resource using the appropriate config
func fetchResourceMetrics(ctx context.Context, resourceID, resType string) (map[string][]float64, error) {
	config, ok := metricConfigs[strings.ToLower(resType)]
	if !ok {
		return nil, fmt.Errorf("no metric config for resource type: %s", resType)
	}

	parts := strings.Split(resourceID, "/")
	if len(parts) < 3 {
		return config.fallback, nil
	}
	subID := parts[2]

	client, err := getMetricsClient(subID)
	if err != nil {
		return config.fallback, nil
	}

	endTime := time.Now()
	startTime := endTime.Add(-7 * 24 * time.Hour)
	timespan := fmt.Sprintf("%s/%s", startTime.Format(time.RFC3339), endTime.Format(time.RFC3339))

	res, err := client.List(ctx, resourceID, &armmonitor.MetricsClientListOptions{
		Timespan:    &timespan,
		Interval:    to.Ptr("PT1H"),
		Metricnames: &config.metricNames,
		Aggregation: to.Ptr("Average"),
	})

	if err != nil {
		return config.fallback, nil
	}

	metrics := parseMetricsResponse(res)
	if len(metrics) == 0 {
		return config.fallback, nil
	}
	return metrics, nil
}

// Backwards compatibility wrappers
func fetchVMExpandedMetrics(ctx context.Context, resourceID string) (map[string][]float64, error) {
	return fetchResourceMetrics(ctx, resourceID, "microsoft.compute/virtualmachines")
}

func fetchSQLMetrics(ctx context.Context, resourceID string) (map[string][]float64, error) {
	return fetchResourceMetrics(ctx, resourceID, "microsoft.sql/servers/databases")
}

func fetchCosmosDBMetrics(ctx context.Context, resourceID string) (map[string][]float64, error) {
	return fetchResourceMetrics(ctx, resourceID, "microsoft.documentdb/databaseaccounts")
}

func fetchAppServiceMetrics(ctx context.Context, resourceID string) (map[string][]float64, error) {
	return fetchResourceMetrics(ctx, resourceID, "microsoft.web/sites")
}

func fetchStorageMetrics(ctx context.Context, resourceID string) (map[string][]float64, error) {
	return fetchResourceMetrics(ctx, resourceID, "microsoft.storage/storageaccounts")
}

func fetchAKSMetrics(ctx context.Context, resourceID string) (map[string][]float64, error) {
	return fetchResourceMetrics(ctx, resourceID, "microsoft.containerservice/managedclusters")
}

// fetchVMAvailability fetches the VmAvailabilityMetric for a VM and returns uptime percentage (0-100)
// over the given number of days. Falls back to Percentage CPU > 0 as a proxy.
func fetchVMAvailability(ctx context.Context, resourceID string, days int) (uptimePct float64, downtimeHours float64, err error) {
	parts := strings.Split(resourceID, "/")
	if len(parts) < 3 {
		return 0, 0, fmt.Errorf("invalid resource ID")
	}
	subID := parts[2]

	client, err := getMetricsClient(subID)
	if err != nil {
		return 0, 0, err
	}

	endTime := time.Now().UTC()
	startTime := endTime.AddDate(0, 0, -days)
	timespan := fmt.Sprintf("%s/%s", startTime.Format(time.RFC3339), endTime.Format(time.RFC3339))

	// Try VmAvailabilityMetric first (Azure preview metric: 1 = available, 0 = not available)
	res, err := client.List(ctx, resourceID, &armmonitor.MetricsClientListOptions{
		Timespan:    &timespan,
		Interval:    to.Ptr("PT1H"),
		Metricnames: to.Ptr("VmAvailabilityMetric"),
		Aggregation: to.Ptr("Average"),
	})
	if err == nil {
		metrics := parseMetricsResponse(res)
		if vals, ok := metrics["VmAvailabilityMetric"]; ok && len(vals) > 0 {
			upCount := 0
			for _, v := range vals {
				if v >= 0.5 {
					upCount++
				}
			}
			total := float64(len(vals))
			if total > 0 {
				uptimePct = float64(upCount) / total * 100
				downtimeHours = (total - float64(upCount))
				return uptimePct, downtimeHours, nil
			}
		}
	}

	// Fallback: use Percentage CPU > 0 as proxy for VM running
	res2, err := client.List(ctx, resourceID, &armmonitor.MetricsClientListOptions{
		Timespan:    &timespan,
		Interval:    to.Ptr("PT1H"),
		Metricnames: to.Ptr("Percentage CPU"),
		Aggregation: to.Ptr("Average"),
	})
	if err != nil {
		return 0, 0, err
	}

	metrics2 := parseMetricsResponse(res2)
	vals, ok := metrics2["Percentage CPU"]
	if !ok || len(vals) == 0 {
		return 0, 0, fmt.Errorf("no CPU metrics available")
	}

	upCount := 0
	for _, v := range vals {
		if v > 0 {
			upCount++
		}
	}
	total := float64(len(vals))
	uptimePct = float64(upCount) / total * 100
	downtimeHours = (total - float64(upCount))
	return uptimePct, downtimeHours, nil
}

// getResourceContext looks up a resource from Azure Resource Graph
func getResourceContext(ctx context.Context, resourceID string) (*AzureResource, error) {
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(resourceID, "/")
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid resource ID format")
	}

	_ = parts[2] // subscription ID extracted for future use

	argClient, err := armresourcegraph.NewClient(cred, nil)
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf("Resources | where id == '%s' | project id, name, type, location, subscriptionId, resourceGroup, tags, status=properties.provisioningState", resourceID)
	request := armresourcegraph.QueryRequest{
		Query: to.Ptr(query),
		Options: &armresourcegraph.QueryRequestOptions{
			ResultFormat: to.Ptr(armresourcegraph.ResultFormatObjectArray),
			Top:          to.Ptr(int32(1)),
		},
	}

	results, err := argClient.Resources(ctx, request, nil)
	if err != nil {
		return nil, err
	}

	rows, ok := results.Data.([]interface{})
	if !ok || len(rows) == 0 {
		return nil, fmt.Errorf("resource not found")
	}

	row, ok := rows[0].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	safeStr := func(v any) string {
		if v == nil {
			return ""
		}
		return fmt.Sprint(v)
	}

	tags := make(map[string]string)
	if t, ok := row["tags"].(map[string]interface{}); ok {
		for k, v := range t {
			tags[k] = safeStr(v)
		}
	}

	// Get cost from cache if available
	cost := 0.0
	if cache != nil {
		subID := safeStr(row["subscriptionId"])
		namePattern := "%" + safeStr(row["name"]) + "%"
		if rows2, err := cache.db.Query("SELECT COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id = ? AND (resource_group = ? OR resource_id LIKE ?)", subID, safeStr(row["resourceGroup"]), namePattern); err == nil {
			defer rows2.Close()
			if rows2.Next() {
				rows2.Scan(&cost)
			}
		}
	}

	// Extract creator information
	createdBy := extractCreatorFromTags(tags)

	return &AzureResource{
		ID:             resourceID,
		Name:           safeStr(row["name"]),
		Type:           safeStr(row["type"]),
		Location:       safeStr(row["location"]),
		SubscriptionID: safeStr(row["subscriptionId"]),
		ResourceGroup:  safeStr(row["resourceGroup"]),
		Status:         safeStr(row["status"]),
		Tags:           tags,
		Cost:           cost,
		CreatedBy:      createdBy,
	}, nil
}

func getRuleBasedRecommendation(resource *AzureResource, stats MetricsSummary) []Recommendation {
	var recs []Recommendation

	cpuStat, hasCPU := stats.Metrics["Percentage CPU"]
	memStat, hasMem := stats.Metrics["Average_MemoryUsagePercentage"]

	avgCPU := -1.0
	avgMem := -1.0
	if hasCPU {
		avgCPU = cpuStat.Avg
	}
	if hasMem {
		avgMem = memStat.Avg
	}

	// Rule: Unused resource
	if avgCPU >= 0 && avgCPU < 5 {
		recs = append(recs, Recommendation{
			Category:         "delete",
			Action:           "Consider deleting or removing this unused resource",
			EstimatedSavings: resource.Cost,
			SavingsPercent:   100,
			Rationale:        fmt.Sprintf("Average CPU utilization is %.1f%% over 7 days - resource appears completely idle", avgCPU),
			Priority:         1,
		})
		return recs
	}

	// Rule: Very low utilization - recommend stop
	if avgCPU >= 0 && avgCPU < 10 && (!hasMem || avgMem < 20) {
		recs = append(recs, Recommendation{
			Category:         "stop",
			Action:           "Stop VM during off-hours (nights and weekends)",
			EstimatedSavings: resource.Cost * 0.65,
			SavingsPercent:   65,
			Rationale:        fmt.Sprintf("CPU %.1f%%, Memory %.1f%% - very low utilization suitable for scheduled shutdown", avgCPU, avgMem),
			Priority:         1,
		})
		return recs
	}

	// Rule: Low utilization - recommend rightsize down
	if avgCPU >= 0 && avgCPU < 20 && (!hasMem || avgMem < 30) {
		recs = append(recs, Recommendation{
			Category:         "rightsize",
			Action:           "Downsize to a smaller VM SKU to reduce costs",
			EstimatedSavings: resource.Cost * 0.40,
			SavingsPercent:   40,
			Rationale:        fmt.Sprintf("CPU P95 is %.1f%%, average is %.1f%% - significant overprovisioning detected", cpuStat.P95, avgCPU),
			Priority:         1,
		})
		return recs
	}

	// Rule: High CPU - recommend upsize
	if avgCPU >= 0 && avgCPU > 80 {
		recs = append(recs, Recommendation{
			Category:         "rightsize",
			Action:           "Upsize to a larger VM SKU for better performance",
			EstimatedSavings: 0,
			SavingsPercent:   0,
			Rationale:        fmt.Sprintf("CPU average is %.1f%%, P95 is %.1f%% - resource is CPU-bound and may be throttling", avgCPU, cpuStat.P95),
			Priority:         1,
		})
		return recs
	}

	// Rule: Dev/test resource with moderate utilization
	if strings.Contains(strings.ToLower(resource.Name), "dev") || strings.Contains(strings.ToLower(resource.Name), "test") {
		if avgCPU >= 0 && avgCPU < 30 {
			recs = append(recs, Recommendation{
				Category:         "schedule",
				Action:           "Implement automated shutdown outside business hours (9am-6pm Mon-Fri)",
				EstimatedSavings: resource.Cost * 0.50,
				SavingsPercent:   50,
				Rationale:        fmt.Sprintf("Dev/test VM with %.1f%% average CPU - likely inactive outside working hours", avgCPU),
				Priority:         2,
			})
			return recs
		}
	}

	// Default: No strong recommendation
	recs = append(recs, Recommendation{
		Category:         "monitor",
		Action:           "Continue monitoring - current utilization appears appropriate",
		EstimatedSavings: 0,
		SavingsPercent:   0,
		Rationale:        fmt.Sprintf("CPU %.1f%% (P95: %.1f%%), Memory %.1f%% - no obvious optimization opportunities", avgCPU, cpuStat.P95, avgMem),
		Priority:         3,
	})

	return recs
}

func getOllamaRecommendation(metrics map[string][]float64, resourceID string, resource *AzureResource) ([]Recommendation, float64, string, error) {
	stats := calculateMetricsStats(metrics)

	// Build utilization text
	var utilLines []string
	for name, stat := range stats.Metrics {
		utilLines = append(utilLines, fmt.Sprintf("- %s:\n  - Average: %.1f%%\n  - Peak (P95): %.1f%%\n  - Minimum: %.1f%%\n  - Maximum: %.1f%%",
			name, stat.Avg, stat.P95, stat.Min, stat.Max))
	}
	utilText := strings.Join(utilLines, "\n")

	prompt := fmt.Sprintf(`You are a senior Azure FinOps engineer. Analyze this Azure resource and provide specific cost optimization recommendations.

## Resource Context
- Resource: %s
- Type: %s
- Resource Group: %s
- Location: %s
- Subscription: %s
- Monthly Cost: $%.2f

## Utilization Statistics (7-day)
%s

## Your Task
Provide exactly 3 cost-saving recommendations. For each recommendation:
1. Category: rightsize | stop | schedule | migrate | delete
2. Specific action (e.g., "Downsize from Standard_D4s_v3 to Standard_D2s_v3")
3. Estimated monthly savings in USD
4. Savings percent relative to current cost
5. Rationale based on the utilization data
6. Priority: 1 (high), 2 (medium), 3 (low)

## Response Format (JSON only, no markdown)
{
  "recommendations": [
    {"category": "rightsize", "action": "Downsize from D4s_v3 to D2s_v3", "estimatedSavings": 85.50, "savingsPercent": 40, "rationale": "P95 CPU is 20%%, average is 12%%", "priority": 1}
  ],
  "confidenceScore": 0.85,
  "overallCategory": "rightsize"
}

Only respond with valid JSON. No markdown, no explanations outside the JSON.`, resource.Name, resource.Type, resource.ResourceGroup, resource.Location, resource.SubscriptionID, resource.Cost, utilText)

	payload := map[string]interface{}{
		"model":  "llama3",
		"prompt": prompt,
		"stream": false,
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, "", fmt.Errorf("failed to marshal payload: %w", err)
	}

	// 10 second timeout
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post("http://localhost:11434/api/generate", "application/json", bytes.NewBuffer(jsonPayload))
	if err != nil {
		return nil, 0, "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, 0, "", fmt.Errorf("failed to read response: %w", err)
	}
	var result struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, 0, "", fmt.Errorf("failed to unmarshal response: %w", err)
	}

	// Parse JSON response
	var parsed struct {
		Recommendations []Recommendation `json:"recommendations"`
		ConfidenceScore float64          `json:"confidenceScore"`
		OverallCategory string           `json:"overallCategory"`
	}

	// Try to extract JSON from response (model might wrap in markdown)
	jsonStr := result.Response
	if strings.Contains(jsonStr, "```json") {
		start := strings.Index(jsonStr, "```json") + 7
		end := strings.Index(jsonStr, "```")
		jsonStr = jsonStr[start:end]
	} else if strings.Contains(jsonStr, "```") {
		start := strings.Index(jsonStr, "```") + 3
		end := strings.LastIndex(jsonStr, "```")
		jsonStr = jsonStr[start:end]
	}

	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil, 0, "", fmt.Errorf("failed to parse Ollama response: %v", err)
	}

	return parsed.Recommendations, parsed.ConfidenceScore, parsed.OverallCategory, nil
}

// fetchVMMetrics returns average CPU and memory utilization for a VM over the specified number of days
func fetchVMMetrics(ctx context.Context, resourceID string, days int) (map[string]float64, error) {
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return fallbackVMMetrics(), nil
	}

	parts := strings.Split(resourceID, "/")
	if len(parts) < 3 {
		return fallbackVMMetrics(), nil
	}
	subID := parts[2]

	client, err := armmonitor.NewMetricsClient(subID, cred, nil)
	if err != nil {
		return fallbackVMMetrics(), nil
	}

	endTime := time.Now()
	startTime := endTime.Add(-time.Duration(days) * 24 * time.Hour)
	timespan := fmt.Sprintf("%s/%s", startTime.Format(time.RFC3339), endTime.Format(time.RFC3339))

	metricNames := "Percentage CPU,Average_MemoryUsagePercentage"
	res, err := client.List(ctx, resourceID, &armmonitor.MetricsClientListOptions{
		Timespan:    &timespan,
		Interval:    to.Ptr("PT1H"),
		Metricnames: &metricNames,
		Aggregation: to.Ptr("Average"),
	})

	if err != nil {
		return fallbackVMMetrics(), nil
	}

	avgCPU := -1.0
	avgMem := -1.0

	for _, m := range res.Value {
		var values []float64
		for _, ts := range m.Timeseries {
			for _, data := range ts.Data {
				if data.Average != nil {
					values = append(values, *data.Average)
				}
			}
		}
		if len(values) == 0 {
			continue
		}
		sum := 0.0
		for _, v := range values {
			sum += v
		}
		avg := sum / float64(len(values))

		if m.Name != nil && m.Name.Value != nil {
			name := *m.Name.Value
			if strings.Contains(strings.ToLower(name), "cpu") {
				avgCPU = avg
			} else if strings.Contains(strings.ToLower(name), "memory") {
				avgMem = avg
			}
		}
	}

	return map[string]float64{"avgCPU": avgCPU, "avgMemory": avgMem}, nil
}

func fallbackVMMetrics() map[string]float64 {
	return map[string]float64{"avgCPU": -1, "avgMemory": -1}
}

func normalizeLocation(loc string) string {
	l := strings.ToLower(strings.ReplaceAll(loc, " ", ""))
	mappings := map[string]string{
		"euwest":         "westeurope",
		"eunorth":        "northeurope",
		"jaeast":         "japaneast",
		"jawest":         "japanwest",
		"ukwest":         "ukwest",
		"uksouth":        "uksouth",
		"uswest":         "westus",
		"uswest2":        "westus2",
		"uswest3":        "westus3",
		"useast":         "eastus",
		"useast2":        "eastus2",
		"uscentral":      "centralus",
		"ussouthcentral": "southcentralus",
		"usnorthcentral": "northcentralus",
		"secentral":      "swedencentral",
		"frcentral":      "francecentral",
		"cacentral":      "canadacentral",
	}
	if m, ok := mappings[l]; ok {
		return m
	}
	return l
}

// normalizeTagValue normalizes an environment tag value to a consistent format
func normalizeTagValue(v string) string {
	lower := strings.ToLower(strings.TrimSpace(v))
	switch lower {
	case "prod", "production":
		return "Production"
	case "stg", "staging", "stage":
		return "Staging"
	case "dev", "development":
		return "Development"
	case "test", "testing", "qa":
		return "Test/QA"
	case "dr", "disaster recovery", "disaster-recovery":
		return "DR"
	case "poc", "demo", "demonstration":
		return "PoC/Demo"
	case "uat":
		return "UAT"
	case "":
		return "Untagged"
	default:
		if len(lower) > 0 {
			return strings.ToUpper(string(lower[0])) + lower[1:]
		}
		return lower
	}
}

// extractCreatorFromTags extracts the creator/owner email from resource tags
func extractCreatorFromTags(tags map[string]string) string {
	// Check common creator/owner tag keys in order of priority
	creatorKeys := []string{
		"createdBy",
		"CreatedBy",
		"created-by",
		"owner",
		"Owner",
		"managedBy",
		"ManagedBy",
		"email",
		"Email",
		"creator",
		"Creator",
		"author",
		"Author",
		"contact",
		"Contact",
	}

	for _, key := range creatorKeys {
		if val, ok := tags[key]; ok && val != "" {
			// Clean up the value - could be email or username
			val = strings.TrimSpace(val)
			// If it looks like an email or UPN, return it
			if strings.Contains(val, "@") || !strings.Contains(val, " ") {
				return val
			}
		}
	}

	return ""
}

// getEnvFromTags extracts the environment value from a resource's tag map
func getEnvFromTags(tags map[string]string) string {
	// Check common environment tag keys in order of priority
	envKeys := []string{"Environment", "environment", "env", "Env", "ENV"}
	for _, key := range envKeys {
		if v, ok := tags[key]; ok && v != "" {
			return normalizeTagValue(v)
		}
	}
	return "Untagged"
}

// ActivityLogEvent represents an Azure Activity Log event
type ActivityLogEvent struct {
	Caller        string    `json:"caller"`
	OperationName string    `json:"operationName"`
	ResourceID    string    `json:"resourceId"`
	EventTimestamp time.Time `json:"eventTimestamp"`
}

// fetchActivityLogs fetches Azure Activity Logs for a subscription within a time range
func fetchActivityLogs(ctx context.Context, subscriptionID string, startTime, endTime time.Time) (map[string][]ActivityLogEvent, error) {
	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, fmt.Errorf("failed to get credentials: %w", err)
	}

	// Build the Activity Logs API URL
	filter := fmt.Sprintf("eventTimestamp ge '%s' and eventTimestamp le '%s'",
		startTime.Format(time.RFC3339),
		endTime.Format(time.RFC3339))

	url := fmt.Sprintf("https://management.azure.com/subscriptions/%s/providers/Microsoft.Insights/eventtypes/management/values?$filter=%s&api-version=2015-04-01",
		subscriptionID, url.QueryEscape(filter))

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	token, err := cred.GetToken(ctx, policy.TokenRequestOptions{
		Scopes: []string{"https://management.azure.com/.default"},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get token: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token.Token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("activity logs API returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Value []struct {
			Caller         json.RawMessage `json:"caller"`
			OperationName struct {
				Value string `json:"value"`
			} `json:"operationName"`
			ResourceID     *string `json:"resourceId"`
			EventTimestamp string `json:"eventTimestamp"`
		} `json:"value"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode activity logs: %w", err)
	}

	// Group events by resource ID for easy lookup
	events := make(map[string][]ActivityLogEvent)
	for _, v := range result.Value {
		if v.ResourceID == nil {
			continue
		}

		// Parse timestamp
		ts, _ := time.Parse(time.RFC3339, v.EventTimestamp)

		// Parse caller - can be string or object
		caller := "Unknown"
		if len(v.Caller) > 0 {
			// Try as string first
			var callerStr string
			if err := json.Unmarshal(v.Caller, &callerStr); err == nil {
				caller = callerStr
			} else {
				// Try as object with emailAddress
				var callerObj struct {
					Email string `json:"emailAddress"`
				}
				if err := json.Unmarshal(v.Caller, &callerObj); err == nil && callerObj.Email != "" {
					caller = callerObj.Email
				}
			}
		}

		event := ActivityLogEvent{
			Caller:         caller,
			OperationName:  v.OperationName.Value,
			ResourceID:     *v.ResourceID,
			EventTimestamp: ts,
		}

		// Normalize resource ID (lowercase for matching)
		resourceIDLower := strings.ToLower(*v.ResourceID)
		events[resourceIDLower] = append(events[resourceIDLower], event)
	}

	return events, nil
}

// findUserForChange looks up the user who made a change to a resource
func findUserForChange(activityLogs map[string][]ActivityLogEvent, resourceID string, changeTime time.Time) string {
	resourceIDLower := strings.ToLower(resourceID)

	events, ok := activityLogs[resourceIDLower]
	if !ok {
		return "Unknown"
	}

	// Prefer the event closest to changeTime, but accept any write/create/delete event
	// within the activity log window (no strict 5-minute cutoff for newly detected resources)
	var bestMatch *ActivityLogEvent
	bestDiff := time.Duration(1<<63 - 1)

	for i := range events {
		e := &events[i]
		if e.Caller == "" || e.Caller == "Unknown" {
			continue
		}
		op := strings.ToLower(e.OperationName)
		if !strings.Contains(op, "/write") && !strings.Contains(op, "/delete") && !strings.Contains(op, "/create") {
			continue
		}
		diff := e.EventTimestamp.Sub(changeTime)
		if diff < 0 {
			diff = -diff
		}
		if diff < bestDiff {
			bestDiff = diff
			bestMatch = e
		}
	}

	if bestMatch != nil {
		return bestMatch.Caller
	}
	return "Unknown"
}

// fetchMarketplacePurchases queries Azure Cost Management for marketplace purchases with dates
func fetchMarketplacePurchases(client *armcostmanagement.QueryClient, sid string, start, end time.Time, ctx context.Context) ([]map[string]any, error) {
	scope := "subscriptions/" + sid
	props := armcostmanagement.QueryDefinition{
		Type: to.Ptr(armcostmanagement.ExportTypeActualCost),
		Dataset: &armcostmanagement.QueryDataset{
			Aggregation: map[string]*armcostmanagement.QueryAggregation{
				"totalCost": {Name: to.Ptr("PreTaxCost"), Function: to.Ptr(armcostmanagement.FunctionTypeSum)},
			},
			Grouping: []*armcostmanagement.QueryGrouping{
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceId")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceGroup")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("PublisherType")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("PublisherName")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("Product")},
			},
			Granularity: to.Ptr(armcostmanagement.GranularityTypeDaily),
			Filter: &armcostmanagement.QueryFilter{
				Dimensions: &armcostmanagement.QueryComparisonExpression{
					Name:     to.Ptr("PublisherType"),
					Operator: to.Ptr(armcostmanagement.QueryOperatorTypeIn),
					Values:   []*string{to.Ptr("Marketplace")},
				},
			},
		},
		Timeframe:  to.Ptr(armcostmanagement.TimeframeTypeCustom),
		TimePeriod: &armcostmanagement.QueryTimePeriod{From: to.Ptr(start), To: to.Ptr(end)},
	}

	return retryAfter429(ctx, sid, func() ([]map[string]any, error) {
		res, err := client.Usage(ctx, scope, props, nil)
		if err != nil {
			return nil, err
		}
		return parseMarketplaceResults(res.QueryResult), nil
	})
}

// fetchCommitmentPurchases queries Azure Cost Management for RI and Savings Plan purchases
func fetchCommitmentPurchases(client *armcostmanagement.QueryClient, sid string, start, end time.Time, ctx context.Context) ([]map[string]any, error) {
	scope := "subscriptions/" + sid
	props := armcostmanagement.QueryDefinition{
		Type: to.Ptr(armcostmanagement.ExportTypeActualCost),
		Dataset: &armcostmanagement.QueryDataset{
			Aggregation: map[string]*armcostmanagement.QueryAggregation{
				"totalCost": {Name: to.Ptr("PreTaxCost"), Function: to.Ptr(armcostmanagement.FunctionTypeSum)},
			},
			Grouping: []*armcostmanagement.QueryGrouping{
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ResourceId")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("MeterCategory")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("MeterSubcategory")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ChargeType")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("ReservationName")},
				{Type: to.Ptr(armcostmanagement.QueryColumnTypeDimension), Name: to.Ptr("BenefitName")},
			},
			Granularity: to.Ptr(armcostmanagement.GranularityTypeDaily),
			// No filter - we'll identify commitments by MeterCategory/Subcategory in parsing
		},
		Timeframe:  to.Ptr(armcostmanagement.TimeframeTypeCustom),
		TimePeriod: &armcostmanagement.QueryTimePeriod{From: to.Ptr(start), To: to.Ptr(end)},
	}

	return retryAfter429(ctx, sid, func() ([]map[string]any, error) {
		res, err := client.Usage(ctx, scope, props, nil)
		if err != nil {
			return nil, err
		}
		return parseCommitmentResults(res.QueryResult), nil
	})
}

func parseCommitmentResults(res armcostmanagement.QueryResult) []map[string]any {
	if res.Properties == nil || res.Properties.Rows == nil {
		return nil
	}

	rows := res.Properties.Rows
	results := make([]map[string]any, 0, len(rows))
	colCost, colDate, colResourceID, colCategory, colSubCategory, colChargeType, colResName, colBenName := -1, -1, -1, -1, -1, -1, -1, -1

	if res.Properties.Columns != nil {
		for i, col := range res.Properties.Columns {
			if col.Name == nil {
				continue
			}
			name := strings.ToLower(*col.Name)
			if strings.Contains(name, "date") || strings.Contains(name, "usage") {
				colDate = i
			}
			if strings.Contains(name, "cost") || strings.Contains(name, "pretax") {
				colCost = i
			}
			if strings.Contains(name, "resourceid") || strings.Contains(name, "resource_id") {
				colResourceID = i
			}
			if strings.Contains(name, "metercategory") || strings.Contains(name, "category") {
				colCategory = i
			}
			if strings.Contains(name, "metersubcategory") || strings.Contains(name, "subcategory") {
				colSubCategory = i
			}
			if strings.Contains(name, "chargetype") || strings.Contains(name, "charge_type") {
				colChargeType = i
			}
			if strings.Contains(name, "reservationname") {
				colResName = i
			}
			if strings.Contains(name, "benefitname") {
				colBenName = i
			}
		}
	}

	// Validate column indices
	if colCost < 0 || colDate < 0 {
		log.Printf("Warning: Could not detect cost/date columns (cost=%d, date=%d)", colCost, colDate)
		return nil
	}

	for _, row := range rows {
		if len(row) <= colCost || len(row) <= colDate {
			continue
		}

		dateVal := fmt.Sprintf("%v", row[colDate])
		costVal := row[colCost]
		cost := parseFloatVal(costVal)

		// Only include non-zero costs
		if cost <= 0 {
			continue
		}

		// Check if this is a commitment-related charge
		isCommitment := false
		commitmentType := ""
		product := ""

		// Check MeterCategory for RI/SP indicators
		if colCategory >= 0 && colCategory < len(row) {
			category := strings.ToLower(fmt.Sprintf("%v", row[colCategory]))
			if strings.Contains(category, "reservation") || strings.Contains(category, "reserved") {
				isCommitment = true
				commitmentType = "Reserved Instance"
				product = category
			} else if strings.Contains(category, "savings plan") || strings.Contains(category, "savingsplan") {
				isCommitment = true
				commitmentType = "Savings Plan"
				product = category
			}
		}

		// Check MeterSubcategory
		if !isCommitment && colSubCategory >= 0 && colSubCategory < len(row) {
			subCategory := strings.ToLower(fmt.Sprintf("%v", row[colSubCategory]))
			if strings.Contains(subCategory, "reservation") || strings.Contains(subCategory, "reserved") {
				isCommitment = true
				commitmentType = "Reserved Instance"
				product = subCategory
			} else if strings.Contains(subCategory, "savings plan") || strings.Contains(subCategory, "savingsplan") {
				isCommitment = true
				commitmentType = "Savings Plan"
				product = subCategory
			}
		}

		// Check ReservationName
		if !isCommitment && colResName >= 0 && colResName < len(row) {
			resName := fmt.Sprintf("%v", row[colResName])
			if resName != "" && resName != "<nil>" {
				isCommitment = true
				commitmentType = "Reserved Instance"
				product = resName
			}
		}

		// Check BenefitName (for Savings Plans)
		if !isCommitment && colBenName >= 0 && colBenName < len(row) {
			benName := fmt.Sprintf("%v", row[colBenName])
			if benName != "" && benName != "<nil>" {
				isCommitment = true
				commitmentType = "Savings Plan"
				product = benName
			}
		}

		// For Purchase charges, also include significant costs (> $100) as potential commitments
		// if they haven't been filtered yet - this catches edge cases
		if !isCommitment && cost > 100 {
			if colCategory >= 0 && colCategory < len(row) {
				category := strings.ToLower(fmt.Sprintf("%v", row[colCategory]))
				// Broad category matching for commitment-related purchases
				if strings.Contains(category, "reserved") || strings.Contains(category, "savings") ||
				   strings.Contains(category, "commitment") || strings.Contains(category, "prepay") {
					isCommitment = true
					commitmentType = "Commitment"
					product = category
				}
			}
		}

		// For commitment purchases, we want ChargeType = "Purchase"
		// Skip if it's not a purchase (e.g., recurring usage charges)
		if colChargeType >= 0 && colChargeType < len(row) {
			chargeType := strings.ToLower(fmt.Sprintf("%v", row[colChargeType]))
			if chargeType != "purchase" {
				isCommitment = false
			}
		}

		if !isCommitment {
			continue
		}

		// Parse date
		dateStr := parseAzureDate(dateVal)

		purchase := map[string]any{
			"date":           dateStr,
			"cost":           cost,
			"commitmentType": commitmentType,
			"product":        product,
		}

		if colResourceID >= 0 && colResourceID < len(row) {
			resourceID := fmt.Sprintf("%v", row[colResourceID])
			purchase["resourceId"] = resourceID
			if idx := strings.LastIndex(resourceID, "/"); idx >= 0 {
				purchase["resourceName"] = resourceID[idx+1:]
			}
			// Extract resource group from resource ID
			if parts := strings.Split(resourceID, "/"); len(parts) >= 5 {
				for i, p := range parts {
					if strings.EqualFold(p, "resourceGroups") && i+1 < len(parts) {
						purchase["resourceGroup"] = parts[i+1]
						break
					}
				}
			}
		}

		if colCategory >= 0 && colCategory < len(row) {
			purchase["category"] = fmt.Sprintf("%v", row[colCategory])
		}

		if colSubCategory >= 0 && colSubCategory < len(row) {
			purchase["subCategory"] = fmt.Sprintf("%v", row[colSubCategory])
		}

		if colChargeType >= 0 && colChargeType < len(row) {
			purchase["chargeType"] = fmt.Sprintf("%v", row[colChargeType])
		}

		results = append(results, purchase)
	}

	return results
}

func parseMarketplaceResults(res armcostmanagement.QueryResult) []map[string]any {
	if res.Properties == nil || res.Properties.Rows == nil {
		return nil
	}

	rows := res.Properties.Rows
	results := make([]map[string]any, 0, len(rows))
	colCost, colDate, colResourceID, colResourceGroup, colPublisher, colProduct := -1, -1, -1, -1, -1, -1

	if res.Properties.Columns != nil {
		for i, col := range res.Properties.Columns {
			if col.Name == nil {
				continue
			}
			name := strings.ToLower(*col.Name)
			if strings.Contains(name, "date") || strings.Contains(name, "usage") {
				colDate = i
			}
			if strings.Contains(name, "cost") || strings.Contains(name, "pretax") {
				colCost = i
			}
			if strings.Contains(name, "resourceid") || strings.Contains(name, "resource_id") {
				colResourceID = i
			}
			if strings.Contains(name, "resourcegroup") || strings.Contains(name, "resource_group") {
				colResourceGroup = i
			}
			if strings.Contains(name, "publishername") || strings.Contains(name, "publisher") {
				colPublisher = i
			}
			if strings.Contains(name, "product") {
				colProduct = i
			}
		}
	}

	// Validate column indices
	if colCost < 0 || colDate < 0 {
		log.Printf("Warning: Could not detect cost/date columns (cost=%d, date=%d)", colCost, colDate)
		return nil
	}

	for _, row := range rows {
		if len(row) <= colCost || len(row) <= colDate {
			continue
		}

		dateVal := fmt.Sprintf("%v", row[colDate])
		costVal := row[colCost]
		cost := parseFloatVal(costVal)

		// Only include non-zero costs
		if cost <= 0 {
			continue
		}

		// Parse date
		dateStr := parseAzureDate(dateVal)

		purchase := map[string]any{
			"date": dateStr,
			"cost": cost,
		}

		if colResourceID >= 0 && colResourceID < len(row) {
			resourceID := fmt.Sprintf("%v", row[colResourceID])
			purchase["resourceId"] = resourceID
			// Extract resource name from ID
			if idx := strings.LastIndex(resourceID, "/"); idx >= 0 {
				purchase["resourceName"] = resourceID[idx+1:]
			}
		}

		if colResourceGroup >= 0 && colResourceGroup < len(row) {
			purchase["resourceGroup"] = fmt.Sprintf("%v", row[colResourceGroup])
		}

		if colPublisher >= 0 && colPublisher < len(row) {
			purchase["publisher"] = fmt.Sprintf("%v", row[colPublisher])
		}

		if colProduct >= 0 && colProduct < len(row) {
			purchase["product"] = fmt.Sprintf("%v", row[colProduct])
		}

		results = append(results, purchase)
	}

	return results
}

func fetchSubscriptionNames(ctx context.Context, subIDs []string) map[string]string {
	result := make(map[string]string)
	if len(subIDs) == 0 {
		return result
	}

	// Check cache first
	var missing []string
	for _, id := range subIDs {
		if name, ok := subscriptionNameCache.Load(id); ok {
			result[id] = name.(string)
		} else {
			missing = append(missing, id)
		}
	}

	if len(missing) == 0 {
		return result
	}

	// Query Azure Resource Graph for subscription names
	// For resourcecontainers: name=subscription display name, subscriptionId=subscription GUID (as a property)
	query := "resourcecontainers | where type == 'microsoft.resources/subscriptions' | extend subId = subscriptionId, subName = name | project subscriptionId=subId, subscriptionName=subName"

	request := armresourcegraph.QueryRequest{
		Query: to.Ptr(query),
		Options: &armresourcegraph.QueryRequestOptions{
			ResultFormat: to.Ptr(armresourcegraph.ResultFormatObjectArray),
		},
	}

	res, err := argClient.Resources(ctx, request, nil)
	if err != nil {
		log.Printf("fetchSubscriptionNames: ARG query failed: %v", err)
		// Return only cached results, don't add fallbacks
		return result
	}

	rows, _ := res.Data.([]interface{})
	log.Printf("fetchSubscriptionNames: ARG query returned %d rows", len(rows))

	for _, row := range rows {
		m, _ := row.(map[string]interface{})
		// Try different field combinations that Azure ARG might return
		subID := fmt.Sprint(m["subscriptionId"])
		subName := fmt.Sprint(m["subscriptionName"])

		// If subscriptionId contains a name (not a GUID), swap them
		if !isUUID(subID) && isUUID(subName) {
			subID, subName = subName, subID
		}

		// If name is still empty or nil, try the 'name' field directly
		if subName == "" || subName == "<nil>" {
			subName = fmt.Sprint(m["name"])
		}

		log.Printf("fetchSubscriptionNames: row - subID=%s, subName=%s", subID, subName)
		if subID != "" && subName != "" && subName != "<nil>" && isUUID(subID) {
			subscriptionNameCache.Store(subID, subName)
			result[subID] = subName
		}
	}

	// Don't add fallbacks - only return actual subscription names found in ARG
	// Subscriptions not found will not be in the result map

	return result
}
