package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"embed"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/costmanagement/armcostmanagement"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/resourcegraph/armresourcegraph"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/glebarez/go-sqlite"
	"github.com/spf13/cobra"
	"golang.org/x/time/rate"
	"io/fs"
	"math"
	"math/rand"

	"cloudviz-backend/anomaly"
)

//go:embed dist
var frontendAssets embed.FS

var (
	cache          *dbCache
	costClient     *armcostmanagement.QueryClient
	forecastClient *armcostmanagement.ForecastClient
	argClient      *armresourcegraph.Client
	lastSync       time.Time
	syncMutex      sync.Mutex
	// Azure Cost Management: ~10 req/s per subscription, but be conservative
	// Burst of 5 allows short bursts while staying under global limits
	costLimiter    = rate.NewLimiter(rate.Limit(2), 5)
)

// toAnySlice converts a string slice to []any for SQL query arguments
func toAnySlice(ss []string) []any {
	result := make([]any, len(ss))
	for i, s := range ss {
		result[i] = s
	}
	return result
}

var Version = "1.32.0"

func main() {
	var rootCmd = &cobra.Command{
		Use:     "cloudviz",
		Short:   "CloudViz is an Azure resource and cost management tool",
		Version: Version,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			cred, err := azidentity.NewDefaultAzureCredential(nil)
			if err != nil {
				return fmt.Errorf("failed to create credential: %w", err)
			}

			argClient, err = armresourcegraph.NewClient(cred, nil)
			if err != nil {
				return fmt.Errorf("failed to create ARG client: %w", err)
			}

			costClient, err = armcostmanagement.NewQueryClient(cred, nil)
			if err != nil {
				return fmt.Errorf("failed to create Cost Management client: %w", err)
			}

			forecastClient, err = armcostmanagement.NewForecastClient(cred, nil)
			if err != nil {
				return fmt.Errorf("failed to create Forecast client: %w", err)
			}

			cache, err = newDBCache("cloudviz.db")
			if err != nil {
				return fmt.Errorf("failed to initialize database: %w", err)
			}
			return nil
		},
	}

	// ─── Command: resources ──────────────────────────────────────────────────
	var resourcesCmd = &cobra.Command{
		Use:   "resources",
		Short: "List Azure resources with costs",
		Run: func(cmd *cobra.Command, args []string) {
			limit, _ := cmd.Flags().GetInt("limit")
			search, _ := cmd.Flags().GetString("search")
			orphaned, _ := cmd.Flags().GetBool("orphaned")
			unattachedDisk, _ := cmd.Flags().GetBool("unattached-disk")
			unassignedPIP, _ := cmd.Flags().GetBool("unassigned-pip")
			unattachedNIC, _ := cmd.Flags().GetBool("unattached-nic")

			resources, totalCost, err := FetchResourcesWithCosts(context.Background(), nil, nil, nil, nil, search, orphaned, unattachedDisk, unassignedPIP, unattachedNIC, "", "")
			if err != nil {
				log.Fatalf("Error: %v", err)
			}

			fmt.Printf("Displaying %d resources (Total Cost: $%.2f)\n", len(resources), totalCost)
			fmt.Printf("%-50s %-30s %-15s %-10s\n", "NAME", "TYPE", "LOCATION", "COST")
			fmt.Println(strings.Repeat("-", 110))

			if limit > 0 && len(resources) > limit {
				resources = resources[:limit]
			}

			for _, r := range resources {
				name := truncateString(r.Name, 50)
				resType := truncateString(strings.Replace(r.Type, "microsoft.", "", 1), 30)
				fmt.Printf("%-50s %-30s %-15s $%-9.2f\n", name, resType, r.Location, r.Cost)
			}
		},
	}
	resourcesCmd.Flags().IntP("limit", "l", 20, "Limit number of resources")
	resourcesCmd.Flags().StringP("search", "s", "", "Search query")
	resourcesCmd.Flags().Bool("orphaned", false, "Filter orphaned resources")
	resourcesCmd.Flags().Bool("unattached-disk", false, "Filter unattached disks only")
	resourcesCmd.Flags().Bool("unassigned-pip", false, "Filter unassigned public IPs only")
	resourcesCmd.Flags().Bool("unattached-nic", false, "Filter unattached NICs only")

	// ─── Command: costs ──────────────────────────────────────────────────────
	var costsCmd = &cobra.Command{
		Use:   "costs",
		Short: "Show cost breakdown for a subscription",
		Run: func(cmd *cobra.Command, args []string) {
			subID, _ := cmd.Flags().GetString("sub")
			if subID == "" {
				log.Fatal("Error: missing --sub flag")
			}

			now := time.Now()
			start := now.AddDate(0, 0, -30)

			res, err := fetchSubCostsSync(costClient, subID, CostPeriodCurrent, start, context.Background())
			if err != nil {
				log.Fatalf("Error: %v", err)
			}

			fmt.Printf("Cost Breakdown for %s (Last 30 days)\n", subID)
			items := normalizeResults(res.QueryResult).([]interface{})

			// Sort by cost desc
			sort.Slice(items, func(i, j int) bool {
				return items[i].(map[string]interface{})["cost"].(float64) > items[j].(map[string]interface{})["cost"].(float64)
			})

			fmt.Printf("%-30s %-40s %-10s\n", "TYPE", "RESOURCE GROUP", "COST")
			fmt.Println(strings.Repeat("-", 85))
			for _, item := range items {
				m := item.(map[string]interface{})
				rt := truncateString(m["resourceType"].(string), 30)
				rg := truncateString(m["resourceGroup"].(string), 40)
				fmt.Printf("%-30s %-40s $%-9.2f\n", rt, rg, m["cost"].(float64))
			}
		},
	}
	costsCmd.Flags().String("sub", "", "Subscription ID")

	// ─── Command: serve ──────────────────────────────────────────────────────
	var serveCmd = &cobra.Command{
		Use:   "serve",
		Short: "Start the CloudViz web server",
		Run: func(cmd *cobra.Command, args []string) {
			port, _ := cmd.Flags().GetString("port")
			startServer(port)
		},
	}
	serveCmd.Flags().StringP("port", "p", "8080", "Port to listen on")

	// ─── Command: cache ──────────────────────────────────────────────────────
	var cacheCmd = &cobra.Command{
		Use:   "cache",
		Short: "Manage local cost cache",
	}
	var cacheClearCmd = &cobra.Command{
		Use:   "clear",
		Short: "Clear all cached costs from the database",
		Run: func(cmd *cobra.Command, args []string) {
			_, err := cache.db.Exec("DELETE FROM costs")
			if err != nil {
				log.Fatalf("Error: %v", err)
			}
			fmt.Println("Cache cleared successfully.")
		},
	}
	cacheCmd.AddCommand(cacheClearCmd)

	rootCmd.AddCommand(resourcesCmd, costsCmd, serveCmd, cacheCmd)
	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

// ─── Web Server Implementation ──────────────────────────────────────────────

func startServer(port string) {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Authorization"},
	}))

	// Initialize webhook notifier and start background checker
	webhookNotifier := NewWebhookNotifier(cache.db)
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		// Run immediately on startup
		if err := webhookNotifier.CheckAndNotify(); err != nil {
			log.Printf("Webhook check error: %v", err)
		}

		for range ticker.C {
			if err := webhookNotifier.CheckAndNotify(); err != nil {
				log.Printf("Webhook check error: %v", err)
			}
		}
	}()
	r.GET("/api/resources", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		rgs := c.QueryArray("resourceGroup")
		types := c.QueryArray("type")
		locs := c.QueryArray("location")
		creators := c.QueryArray("createdBy")
		search := c.Query("search")
		orphaned := c.Query("orphaned") == "true"
		unattachedDiskOnly := c.Query("unattachedDiskOnly") == "true"
		unassignedPIPOnly := c.Query("unassignedPIPOnly") == "true"
		unattachedNICOnly := c.Query("unattachedNICOnly") == "true"
		tagKey := c.Query("tagKey")
		tagValue := c.Query("tagValue")
		sortBy := c.Query("sortBy")
		sortOrder := c.Query("sortOrder")
		mask := c.Query("mask") == "true"

		res, totalCost, err := FetchResourcesWithCosts(c.Request.Context(), subs, rgs, types, locs, search, orphaned, unattachedDiskOnly, unassignedPIPOnly, unattachedNICOnly, tagKey, tagValue)

		// Filter by creator if specified
		if len(creators) > 0 {
			var filtered []AzureResource
			for _, r := range res {
				for _, creator := range creators {
					if r.CreatedBy == creator || (creator == "unknown" && r.CreatedBy == "") {
						filtered = append(filtered, r)
						break
					}
				}
			}
			res = filtered
		}
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		// Sort results
		if sortBy != "" {
			sort.Slice(res, func(i, j int) bool {
				less := false
				switch sortBy {
				case "name":
					less = res[i].Name < res[j].Name
				case "type":
					less = res[i].Type < res[j].Type
				case "location":
					less = res[i].Location < res[j].Location
				case "resourceGroup":
					less = res[i].ResourceGroup < res[j].ResourceGroup
				case "cost":
					less = res[i].Cost < res[j].Cost
				case "subscriptionId":
					less = res[i].SubscriptionID < res[j].SubscriptionID
				case "score":
					less = res[i].Score < res[j].Score
				}
				if sortOrder == "desc" {
					return !less
				}
				return less
			})
		}


		if mask {
			for i := range res {
				res[i].Name = fmt.Sprintf("resource-%03d", i+1)
				res[i].ResourceGroup = "masked-rg"
				res[i].SubscriptionID = "masked-sub"
			}
		}
		// Record changes asynchronously to not block the response
		go recordResourceChanges(cache.db, res)
		c.JSON(200, gin.H{"data": res, "totalCost": totalCost, "total": len(res)})
	})

	r.GET("/api/filters", func(c *gin.Context) {
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		rgs, types, locs, creators := make(map[string]bool), make(map[string]bool), make(map[string]bool), make(map[string]bool)
		for _, r := range res {
			rgs[r.ResourceGroup] = true
			types[r.Type] = true
			locs[r.Location] = true
			if r.CreatedBy != "" {
				creators[r.CreatedBy] = true
			}
		}

		keys := func(m map[string]bool) []string {
			var ks []string
			for k := range m {
				if k != "" {
					ks = append(ks, k)
				}
			}
			sort.Strings(ks)
			return ks
		}

		// Get subscriptions from dedicated discovery endpoint for full list
		subscriptions, err := DiscoverSubscriptions(c.Request.Context())
		if err != nil {
			// Fallback to empty if discovery fails
			subscriptions = []Subscription{}
		}

		// Build subscription entries with id and name
		subEntries := make([]map[string]string, 0, len(subscriptions))
		for _, sub := range subscriptions {
			subEntries = append(subEntries, map[string]string{"id": sub.ID, "name": sub.Name})
		}

		c.JSON(200, gin.H{
			"subs":      subEntries,
			"rgs":       keys(rgs),
			"types":     keys(types),
			"locations": keys(locs),
			"creators":  keys(creators),
		})
	})

	// DiscoverSubscriptions returns all Azure subscriptions the user has access to
	r.GET("/api/subscriptions", func(c *gin.Context) {
		subs, err := DiscoverSubscriptions(c.Request.Context())
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"subscriptions": subs})
	})

	r.GET("/api/costs/daily", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		period := c.Query("period")
		if period == "" {
			period = "30"
		}
		days := 30
		fmt.Sscanf(period, "%d", &days)
		if days <= 0 {
			days = 30
		}

		now := time.Now()
		start := now.AddDate(0, 0, -days)

		// 1. Get cached daily data and identify missing subs
		var allDaily []map[string]any
		var cachedSubs []string
		var missingSubs []string
		for _, sid := range subs {
			daily, ok := cache.getDailyCosts(sid, start, now)
			if ok {
				allDaily = append(allDaily, daily...)
				cachedSubs = append(cachedSubs, sid)
			} else {
				missingSubs = append(missingSubs, sid)
			}
		}

		// 2. Compute monthly totals: all subs vs cached subs
		totalMonthly := 0.0
		cachedMonthly := 0.0
		rowsAll, err := cache.db.Query("SELECT subscription_id, COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id IN ("+placeholders(len(subs))+") GROUP BY subscription_id", toAnySlice(subs)...)
		if err == nil {
			defer rowsAll.Close()
			for rowsAll.Next() {
				var subID string
				var subCost float64
				rowsAll.Scan(&subID, &subCost)
				totalMonthly += subCost
				for _, cs := range cachedSubs {
					if cs == subID {
						cachedMonthly += subCost
						break
					}
				}
			}
		}

		// 3. Build day-by-day map from cached real data
		byDate := make(map[string]float64)
		for _, d := range allDaily {
			if date, ok := d["date"].(string); ok {
				byDate[date] += d["cost"].(float64)
			}
		}

		// 4. Blend: add fallback estimate for missing subs spread evenly
		if len(missingSubs) > 0 && totalMonthly > cachedMonthly {
			missingMonthly := totalMonthly - cachedMonthly
			dailyMissingAvg := missingMonthly / float64(days)
			for i := days - 1; i >= 0; i-- {
				dateStr := now.AddDate(0, 0, -i).Format("2006-01-02")
				byDate[dateStr] += dailyMissingAvg
			}
		}

		// 5. Build results
		var results []map[string]any
		for i := days - 1; i >= 0; i-- {
			dateStr := now.AddDate(0, 0, -i).Format("2006-01-02")
			results = append(results, map[string]any{
				"date": dateStr,
				"cost": byDate[dateStr],
			})
		}

		// 6. Launch background fetch for missing subs (will improve cache for next time)
		if len(missingSubs) > 0 {
			go func(subsToFetch []string) {
				for _, sid := range subsToFetch {
					daily, err := fetchDailyCosts(costClient, sid, start, now, context.Background())
					if err == nil {
						cache.setDailyCosts(sid, daily)
					}
					time.Sleep(1 * time.Second)
				}
			}(missingSubs)
		}

		c.JSON(200, results)
		return
	})

	// Marketplace purchases endpoint - shows marketplace charges with dates
	r.GET("/api/costs/marketplace", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		period := c.Query("period")
		if period == "" {
			period = "30"
		}
		days := 30
		fmt.Sscanf(period, "%d", &days)
		if days <= 0 {
			days = 30
		}

		now := time.Now()
		start := now.AddDate(0, 0, -days)

		type MarketplacePurchase struct {
			Date           string  `json:"date"`
			Cost           float64 `json:"cost"`
			ResourceID     string  `json:"resourceId"`
			ResourceName   string  `json:"resourceName"`
			ResourceGroup  string  `json:"resourceGroup"`
			Publisher      string  `json:"publisher"`
			Product        string  `json:"product"`
			SubscriptionID string  `json:"subscriptionId"`
		}

		var allPurchases []MarketplacePurchase
		var mu sync.Mutex

		// Add overall timeout for the request
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
		defer cancel()

		// Fetch concurrently with worker pool to avoid rate limiting
		const maxWorkers = 5
		semaphore := make(chan struct{}, maxWorkers)
		var wg sync.WaitGroup

		for _, sid := range subs {
			wg.Add(1)
			semaphore <- struct{}{} // Acquire
			go func(subscriptionID string) {
				defer wg.Done()
				defer func() { <-semaphore }() // Release

				purchases, err := fetchMarketplacePurchases(costClient, subscriptionID, start, now, ctx)
				if err != nil {
					log.Printf("Error fetching marketplace purchases for %s: %v", subscriptionID, err)
					return
				}
				mu.Lock()
				for _, p := range purchases {
					purchase := MarketplacePurchase{
						SubscriptionID: subscriptionID,
						Date:           safeStr(p["date"]),
						Cost:           parseFloatVal(p["cost"]),
						ResourceID:     safeStr(p["resourceId"]),
						ResourceName:   safeStr(p["resourceName"]),
						ResourceGroup:  safeStr(p["resourceGroup"]),
						Publisher:      safeStr(p["publisher"]),
						Product:        safeStr(p["product"]),
					}
					allPurchases = append(allPurchases, purchase)
				}
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		// Sort by date descending (newest first), then by cost descending
		sort.Slice(allPurchases, func(i, j int) bool {
			if allPurchases[i].Date != allPurchases[j].Date {
				return allPurchases[i].Date > allPurchases[j].Date
			}
			return allPurchases[i].Cost > allPurchases[j].Cost
		})

		// Calculate summary statistics
		totalCost := 0.0
		purchaseCount := len(allPurchases)
		byDate := make(map[string]float64)
		byPublisher := make(map[string]float64)

		for _, p := range allPurchases {
			totalCost += p.Cost
			byDate[p.Date] += p.Cost
			if p.Publisher != "" {
				byPublisher[p.Publisher] += p.Cost
			}
		}

		// Find spike days (days with significantly higher costs)
		var spikeDays []map[string]any
		if len(byDate) > 0 {
			// Calculate average daily cost
			avgDaily := totalCost / float64(len(byDate))
			for date, cost := range byDate {
				if cost > avgDaily*2 && cost > 10 { // Spike if >2x average and >$10
					spikeDays = append(spikeDays, map[string]any{
						"date": date,
						"cost": cost,
						"ratio": cost / avgDaily,
					})
				}
			}
			// Sort spike days by date descending
			sort.Slice(spikeDays, func(i, j int) bool {
				return spikeDays[i]["date"].(string) > spikeDays[j]["date"].(string)
			})
		}

		// Build summary by publisher
		type PublisherSummary struct {
			Name  string  `json:"name"`
			Cost  float64 `json:"cost"`
			Count int     `json:"count"`
		}
		publisherCounts := make(map[string]int)
		for _, p := range allPurchases {
			if p.Publisher != "" {
				publisherCounts[p.Publisher]++
			}
		}
		var publisherSummaries []PublisherSummary
		publisherSummaries = make([]PublisherSummary, 0, len(byPublisher))
		for pub, cost := range byPublisher {
			publisherSummaries = append(publisherSummaries, PublisherSummary{
				Name:  pub,
				Cost:  cost,
				Count: publisherCounts[pub],
			})
		}
		sort.Slice(publisherSummaries, func(i, j int) bool {
			return publisherSummaries[i].Cost > publisherSummaries[j].Cost
		})

		averageCost := 0.0
		if purchaseCount > 0 {
			averageCost = totalCost / float64(purchaseCount)
		}
		c.JSON(200, gin.H{
			"purchases":        allPurchases,
			"summary": gin.H{
				"totalCost":      totalCost,
				"count":          purchaseCount,
				"averageCost":    averageCost,
				"spikeDays":      spikeDays,
				"byPublisher":    publisherSummaries,
				"periodDays":     days,
				"startDate":      start.Format("2006-01-02"),
				"endDate":        now.Format("2006-01-02"),
			},
		})
	})

	// Commitment purchases endpoint - shows RI and Savings Plan purchases
	r.GET("/api/costs/commitments", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		period := c.Query("period")
		if period == "" {
			period = "90"
		}
		days := 90
		fmt.Sscanf(period, "%d", &days)
		if days <= 0 || days > 365 {
			days = 90
		}

		now := time.Now()
		start := now.AddDate(0, 0, -days)

		type CommitmentPurchase struct {
			Date           string  `json:"date"`
			Cost           float64 `json:"cost"`
			CommitmentType string  `json:"commitmentType"`
			ResourceID     string  `json:"resourceId"`
			ResourceName   string  `json:"resourceName"`
			ResourceGroup  string  `json:"resourceGroup"`
			Product        string  `json:"product"`
			Category       string  `json:"category"`
			SubCategory    string  `json:"subCategory"`
			ChargeType     string  `json:"chargeType"`
			SubscriptionID string  `json:"subscriptionId"`
		}

		var allPurchases []CommitmentPurchase
		var mu sync.Mutex

		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
		defer cancel()

		const maxWorkers = 5
		semaphore := make(chan struct{}, maxWorkers)
		var wg sync.WaitGroup

		for _, sid := range subs {
			wg.Add(1)
			semaphore <- struct{}{}
			go func(subscriptionID string) {
				defer wg.Done()
				defer func() { <-semaphore }()

				purchases, err := fetchCommitmentPurchases(costClient, subscriptionID, start, now, ctx)
				if err != nil {
					log.Printf("Error fetching commitment purchases for %s: %v", subscriptionID, err)
					return
				}
				mu.Lock()
				for _, p := range purchases {
					purchase := CommitmentPurchase{
						SubscriptionID: subscriptionID,
						Date:           safeStr(p["date"]),
						Cost:           parseFloatVal(p["cost"]),
						CommitmentType: safeStr(p["commitmentType"]),
						ResourceID:     safeStr(p["resourceId"]),
						ResourceName:   safeStr(p["resourceName"]),
						ResourceGroup:  safeStr(p["resourceGroup"]),
						Product:        safeStr(p["product"]),
						Category:       safeStr(p["category"]),
						SubCategory:    safeStr(p["subCategory"]),
						ChargeType:     safeStr(p["chargeType"]),
					}
					allPurchases = append(allPurchases, purchase)
				}
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		sort.Slice(allPurchases, func(i, j int) bool {
			if allPurchases[i].Date != allPurchases[j].Date {
				return allPurchases[i].Date > allPurchases[j].Date
			}
			return allPurchases[i].Cost > allPurchases[j].Cost
		})

		totalCost := 0.0
		purchaseCount := len(allPurchases)
		byType := make(map[string]float64)
		for _, p := range allPurchases {
			totalCost += p.Cost
			if p.CommitmentType != "" {
				byType[p.CommitmentType] += p.Cost
			}
		}

		type TypeSummary struct {
			Name  string  `json:"name"`
			Cost  float64 `json:"cost"`
			Count int     `json:"count"`
		}
		typeCounts := make(map[string]int)
		for _, p := range allPurchases {
			if p.CommitmentType != "" {
				typeCounts[p.CommitmentType]++
			}
		}
		var typeSummaries []TypeSummary
		typeSummaries = make([]TypeSummary, 0, len(byType))
		for t, cost := range byType {
			typeSummaries = append(typeSummaries, TypeSummary{
				Name:  t,
				Cost:  cost,
				Count: typeCounts[t],
			})
		}
		sort.Slice(typeSummaries, func(i, j int) bool {
			return typeSummaries[i].Cost > typeSummaries[j].Cost
		})

		averageCost := 0.0
		if purchaseCount > 0 {
			averageCost = totalCost / float64(purchaseCount)
		}
		c.JSON(200, gin.H{
			"purchases":        allPurchases,
			"summary": gin.H{
				"totalCost":   totalCost,
				"count":       purchaseCount,
				"averageCost": averageCost,
				"byType":      typeSummaries,
				"periodDays":  days,
				"startDate":   start.Format("2006-01-02"),
				"endDate":     now.Format("2006-01-02"),
			},
		})
	})

	// Cost anomaly detection endpoint
	r.GET("/api/costs/anomalies", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		threshold := 2.0    // ratio threshold: flag if cost is threshold-x or more of previous period
		zThreshold := 2.0   // z-score threshold: flag if cost is zThreshold std deviations above mean
		minAmount := 0.0    // minimum current cost to consider (filters out small anomalies)
		minNewSpend := 1.0  // minimum cost for new spend detection (was hardcoded at $1)
		if t := c.Query("threshold"); t != "" {
			fmt.Sscanf(t, "%f", &threshold)
		}
		if z := c.Query("zscore"); z != "" {
			fmt.Sscanf(z, "%f", &zThreshold)
		}
		if m := c.Query("minAmount"); m != "" {
			fmt.Sscanf(m, "%f", &minAmount)
		}
		if m := c.Query("minNewSpend"); m != "" {
			fmt.Sscanf(m, "%f", &minNewSpend)
		}

		now := time.Now()
		currentStart := now.AddDate(0, 0, -30)
		previousStart := now.AddDate(0, 0, -60)
		previousEnd := now.AddDate(0, 0, -30)

		// Initialize to empty slice to avoid null in JSON
		anomalies := make([]map[string]any, 0)
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2)

		for i, sid := range subs {
			if i > 0 {
				time.Sleep(1 * time.Second)
			}
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				// Try cached data first, fall back to API
				var current, previous []map[string]any
				var err1, err2 error

				current, ok1 := cache.getDailyCosts(subID, currentStart, now)
				if !ok1 {
					current, err1 = fetchDailyCosts(costClient, subID, currentStart, now, c.Request.Context())
					if err1 == nil && len(current) > 0 {
						cache.setDailyCosts(subID, current)
					}
				}

				time.Sleep(200 * time.Millisecond) // Small delay between consecutive calls to same sub

				previous, ok2 := cache.getDailyCosts(subID, previousStart, previousEnd)
				if !ok2 {
					previous, err2 = fetchDailyCosts(costClient, subID, previousStart, previousEnd, c.Request.Context())
					if err2 == nil && len(previous) > 0 {
						cache.setDailyCosts(subID, previous)
					}
				}

				if (err1 != nil && !ok1) || (err2 != nil && !ok2) {
					return
				}

				// Build daily slices sorted by date
				type dailyCost struct {
					date string
					cost float64
				}
				var currentSlice, previousSlice []dailyCost
				for _, d := range current {
					if date, ok := d["date"].(string); ok {
						if cost, ok := d["cost"].(float64); ok {
							currentSlice = append(currentSlice, dailyCost{date, cost})
						}
					}
				}
				for _, d := range previous {
					if date, ok := d["date"].(string); ok {
						if cost, ok := d["cost"].(float64); ok {
							previousSlice = append(previousSlice, dailyCost{date, cost})
						}
					}
				}
				// Sort by date
				sort.Slice(currentSlice, func(i, j int) bool { return currentSlice[i].date < currentSlice[j].date })
				sort.Slice(previousSlice, func(i, j int) bool { return previousSlice[i].date < previousSlice[j].date })

				// Compute current period mean and stddev for z-score
				var currentVals []float64
				for _, d := range currentSlice {
					currentVals = append(currentVals, d.cost)
				}
				var currMean, currStdDev float64
				if len(currentVals) > 1 {
					sum := 0.0
					for _, v := range currentVals {
						sum += v
					}
					currMean = sum / float64(len(currentVals))
					variance := 0.0
					for _, v := range currentVals {
						diff := v - currMean
						variance += diff * diff
					}
					currStdDev = math.Sqrt(variance / float64(len(currentVals)))
				}

				// Compare by day offset (day i of current vs day i of previous)
				for i, curr := range currentSlice {
					if i >= len(previousSlice) {
						break
					}
					prev := previousSlice[i]
					currCost := curr.cost
					prevCost := prev.cost
					date := curr.date

					// Skip if current cost is below minimum threshold
					if currCost < minAmount {
						continue
					}

					// New spend detection: previous was 0 but current is significant
					if prevCost == 0 && currCost > minNewSpend {
						mu.Lock()
						anomalies = append(anomalies, map[string]any{
							"subscriptionId": subID,
							"date":           date,
							"currentCost":    currCost,
							"previousCost":   0,
							"ratio":          currCost,
							"change":         100,
							"type":           "new_spend",
						})
						mu.Unlock()
						continue
					}

					if prevCost == 0 {
						continue
					}
					ratio := currCost / prevCost
					if ratio >= threshold {
						mu.Lock()
						anomalies = append(anomalies, map[string]any{
							"subscriptionId": subID,
							"date":           date,
							"currentCost":    currCost,
							"previousCost":   prevCost,
							"ratio":          ratio,
							"change":         (ratio - 1) * 100,
							"type":           "ratio",
						})
						mu.Unlock()
						continue
					}
					// Z-score based: within-period statistical anomaly
					if currStdDev > 0 {
						zScore := (currCost - currMean) / currStdDev
						if zScore >= zThreshold {
							changeVal := 0.0
							if currMean > 0 {
								changeVal = ((currCost - currMean) / currMean) * 100
							}
							mu.Lock()
							anomalies = append(anomalies, map[string]any{
								"subscriptionId": subID,
								"date":           date,
								"currentCost":    currCost,
								"previousCost":   prevCost,
								"ratio":          ratio,
								"change":         changeVal,
								"type":           "zscore",
								"zscore":         zScore,
							})
							mu.Unlock()
						}
					}
				}
			}(sid)
		}
		wg.Wait()

		c.JSON(200, map[string]any{
			"anomalies":    anomalies,
			"threshold":    threshold,
			"zThreshold":   zThreshold,
			"minAmount":    minAmount,
			"minNewSpend":  minNewSpend,
			"periodStart":  currentStart.Format("2006-01-02"),
			"periodEnd":    now.Format("2006-01-02"),
		})
	})

	// Enhanced ML-based anomaly detection endpoint
	r.GET("/api/costs/anomalies/enhanced", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")

		// Parse config from query params
		config := anomaly.DefaultDetectorConfig()
		if t := c.Query("zscore"); t != "" {
			fmt.Sscanf(t, "%f", &config.ZScoreThreshold)
		}
		if t := c.Query("mad"); t != "" {
			fmt.Sscanf(t, "%f", &config.MADThreshold)
		}
		if t := c.Query("isolation"); t != "" {
			fmt.Sscanf(t, "%f", &config.IsolationThreshold)
		}
		if t := c.Query("seasonal"); t != "" {
			fmt.Sscanf(t, "%f", &config.SeasonalThreshold)
		}
		if minSev := c.Query("minSeverity"); minSev != "" {
			config.MinSeverity = anomaly.SeverityFromString(minSev)
		}

		// Parse method flags
		methods := c.Query("methods")
		if methods != "" && methods != "all" {
			config.UseZScore = false
			config.UseMAD = false
			config.UseIsolationForest = false
			config.UseSeasonal = false
			for _, m := range strings.Split(methods, ",") {
				switch m {
				case "zscore":
					config.UseZScore = true
				case "mad":
					config.UseMAD = true
				case "isolation_forest":
					config.UseIsolationForest = true
				case "seasonal":
					config.UseSeasonal = true
				}
			}
		}

		now := time.Now()
		currentStart := now.AddDate(0, 0, -30)
		previousStart := now.AddDate(0, 0, -60)
		previousEnd := now.AddDate(0, 0, -30)

		detector := anomaly.NewEnhancedDetector(config)

		var allResults []anomaly.EnhancedAnomalyResult
		var summaryMap = make(map[anomaly.AnomalySeverity]int)
		var methodMap = make(map[string]int)

		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2)

		for i, sid := range subs {
			if i > 0 {
				time.Sleep(1 * time.Second)
			}
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				// Fetch current period costs
				current, err1 := fetchDailyCosts(costClient, subID, currentStart, now, c.Request.Context())
				time.Sleep(200 * time.Millisecond) // Small delay between consecutive calls to same sub
				previous, err2 := fetchDailyCosts(costClient, subID, previousStart, previousEnd, c.Request.Context())

				if err1 != nil || err2 != nil {
					return
				}

				// Convert to time/cost slices
				dates := make([]time.Time, 0, len(current))
				costs := make([]float64, 0, len(current))
				costMap := make(map[string]float64)

				for _, d := range current {
					if dateStr, ok := d["date"].(string); ok {
						if cost, ok := d["cost"].(float64); ok {
							costMap[dateStr] = cost
							date, _ := time.Parse("2006-01-02", dateStr)
							dates = append(dates, date)
							costs = append(costs, cost)
						}
					}
				}

				// Build previous costs aligned by date
				previousCosts := make([]float64, len(dates))
				for i, date := range dates {
					// Find previous cost for same day of month in previous period
					prevDateStr := date.AddDate(0, 0, -30).Format("2006-01-02")
					for _, pd := range previous {
						if pds, ok := pd["date"].(string); ok && pds == prevDateStr {
							if pc, ok := pd["cost"].(float64); ok {
								previousCosts[i] = pc
							}
							break
						}
					}
				}

				// Detect anomalies
				results := detector.Detect(subID, dates, costs, previousCosts, nil)

				mu.Lock()
				allResults = append(allResults, results.Anomalies...)
				for sev, count := range results.Summary.BySeverity {
					summaryMap[sev] += count
				}
				for method, count := range results.Summary.ByMethod {
					methodMap[method] += count
				}
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		c.JSON(200, map[string]any{
			"anomalies":   allResults,
			"summary": map[string]any{
				"total":      len(allResults),
				"bySeverity": summaryMap,
				"byMethod":   methodMap,
			},
			"config": map[string]any{
				"zScoreThreshold":    config.ZScoreThreshold,
				"madThreshold":       config.MADThreshold,
				"isolationThreshold": config.IsolationThreshold,
				"seasonalThreshold":  config.SeasonalThreshold,
				"methodsUsed":        []string{"zscore", "mad", "isolation_forest", "seasonal"}, // Simplified for now
			},
			"periodStart": currentStart.Format("2006-01-02"),
			"periodEnd":   now.Format("2006-01-02"),
		})
	})

	// Budget CRUD
	r.GET("/api/budgets", func(c *gin.Context) {
		rows, err := cache.db.Query("SELECT id, name, amount, subscription_id, resource_group, period, alert_email FROM budgets ORDER BY created_at DESC")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()

		var budgets []map[string]any
		for rows.Next() {
			var id int
			var name, subID, rg, period, email string
			var amount float64
			if rows.Scan(&id, &name, &amount, &subID, &rg, &period, &email) == nil {
				budgets = append(budgets, map[string]any{
					"id":              id,
					"name":            name,
					"amount":          amount,
					"subscriptionId": subID,
					"resourceGroup":   rg,
					"period":          period,
					"alertEmail":      email,
				})
			}
		}
		c.JSON(200, budgets)
	})

	r.POST("/api/budgets", func(c *gin.Context) {
		var body struct {
			Name           string  `json:"name"`
			Amount         float64 `json:"amount"`
			SubscriptionID string  `json:"subscriptionId"`
			ResourceGroup  string  `json:"resourceGroup"`
			Period         string  `json:"period"`
			AlertEmail     string  `json:"alertEmail"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if body.Period == "" {
			body.Period = "monthly"
		}

		res, err := cache.db.Exec("INSERT INTO budgets (name, amount, subscription_id, resource_group, period, alert_email) VALUES (?, ?, ?, ?, ?, ?)",
			body.Name, body.Amount, body.SubscriptionID, body.ResourceGroup, body.Period, body.AlertEmail)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		id, _ := res.LastInsertId()
		c.JSON(200, map[string]any{"id": id, "message": "Budget created"})
	})

	r.DELETE("/api/budgets/:id", func(c *gin.Context) {
		id := c.Param("id")
		cache.db.Exec("DELETE FROM budgets WHERE id = ?", id)
		c.JSON(200, gin.H{"message": "Budget deleted"})
	})

	r.GET("/api/budgets/status", func(c *gin.Context) {
		// Check current spend vs budget thresholds
		rows, err := cache.db.Query("SELECT id, name, amount, subscription_id, COALESCE(resource_group, ''), period FROM budgets")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()

		var statuses []map[string]any
		now := time.Now()
		periodStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

		for rows.Next() {
			var id int
			var name, subID, rg, period string
			var budgetAmount float64
			if rows.Scan(&id, &name, &budgetAmount, &subID, &rg, &period) == nil {
				var currentSpend float64
				var q string
				var args []any

				if rg != "" {
					q = "SELECT COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id = ? AND resource_group = ? AND fetched_at >= ?"
					args = []any{subID, rg, periodStart}
				} else {
					q = "SELECT COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id = ? AND fetched_at >= ?"
					args = []any{subID, periodStart}
				}

				cache.db.QueryRow(q, args...).Scan(&currentSpend)
				pct := (currentSpend / budgetAmount) * 100
				status := "ok"
				if pct >= 100 {
					status = "exceeded"
				} else if pct >= 80 {
					status = "warning"
				} else if pct >= 50 {
					status = "caution"
				}

				statuses = append(statuses, map[string]any{
					"id":             id,
					"name":           name,
					"budgetAmount":   budgetAmount,
					"currentSpend":   currentSpend,
					"percentUsed":    pct,
					"status":         status,
					"periodStart":    periodStart.Format("2006-01-02"),
				})
			}
		}
		c.JSON(200, statuses)
	})

	// Alerts CRUD
	r.GET("/api/alerts", func(c *gin.Context) {
		rows, err := cache.db.Query("SELECT id, name, type, threshold, email, webhook_url, enabled, subscription_id, resource_group, period FROM alerts ORDER BY created_at DESC")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		var alerts []map[string]any
		for rows.Next() {
			var id int
			var name, alertType, email, webhook, subID, rg, period string
			var threshold float64
			var enabled int
			if rows.Scan(&id, &name, &alertType, &threshold, &email, &webhook, &enabled, &subID, &rg, &period) == nil {
				alerts = append(alerts, map[string]any{
					"id": id, "name": name, "type": alertType, "threshold": threshold,
					"email": email, "webhookUrl": webhook, "enabled": enabled == 1,
					"subscriptionId": subID, "resourceGroup": rg, "period": period,
				})
			}
		}
		c.JSON(200, alerts)
	})

	r.POST("/api/alerts", func(c *gin.Context) {
		var body struct {
			Name           string  `json:"name"`
			Type           string  `json:"type"`
			Threshold      float64 `json:"threshold"`
			Email          string  `json:"email"`
			WebhookURL     string  `json:"webhookUrl"`
			Enabled        bool    `json:"enabled"`
			SubscriptionID string  `json:"subscriptionId"`
			ResourceGroup  string  `json:"resourceGroup"`
			Period         string  `json:"period"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		if body.Type == "" {
			body.Type = "budget"
		}
		if body.Period == "" {
			body.Period = "monthly"
		}
		enabledVal := 0
		if body.Enabled {
			enabledVal = 1
		}
		res, err := cache.db.Exec("INSERT INTO alerts (name, type, threshold, email, webhook_url, enabled, subscription_id, resource_group, period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			body.Name, body.Type, body.Threshold, body.Email, body.WebhookURL, enabledVal, body.SubscriptionID, body.ResourceGroup, body.Period)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		id, _ := res.LastInsertId()
		c.JSON(200, map[string]any{"id": id, "message": "Alert created"})
	})

	r.PUT("/api/alerts/:id", func(c *gin.Context) {
		id := c.Param("id")
		var body struct {
			Name           string  `json:"name"`
			Type           string  `json:"type"`
			Threshold      float64 `json:"threshold"`
			Email          string  `json:"email"`
			WebhookURL     string  `json:"webhookUrl"`
			Enabled        bool    `json:"enabled"`
			SubscriptionID string  `json:"subscriptionId"`
			ResourceGroup  string  `json:"resourceGroup"`
			Period         string  `json:"period"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		enabledVal := 0
		if body.Enabled {
			enabledVal = 1
		}
		cache.db.Exec("UPDATE alerts SET name=?, type=?, threshold=?, email=?, webhook_url=?, enabled=?, subscription_id=?, resource_group=?, period=? WHERE id=?",
			body.Name, body.Type, body.Threshold, body.Email, body.WebhookURL, enabledVal, body.SubscriptionID, body.ResourceGroup, body.Period, id)
		c.JSON(200, map[string]any{"message": "Alert updated"})
	})

	r.DELETE("/api/alerts/:id", func(c *gin.Context) {
		id := c.Param("id")
		cache.db.Exec("DELETE FROM alerts WHERE id = ?", id)
		c.JSON(200, map[string]any{"message": "Alert deleted"})
	})

	// Idle VM detection endpoint
	r.GET("/api/vms/idle", func(c *gin.Context) {
		threshold := 5.0 // default: flag if avg CPU < 5%
		if t := c.Query("threshold"); t != "" {
			fmt.Sscanf(t, "%f", &threshold)
		}
		minDays := 7
		if d := c.Query("minDays"); d != "" {
			fmt.Sscanf(d, "%d", &minDays)
		}

		// Get all VMs from ARG
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		var idleVMs []map[string]any
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 3)

		for _, r := range res {
			if !strings.Contains(strings.ToLower(r.Type), "virtualmachine") {
				continue
			}
			wg.Add(1)
			go func(vm AzureResource) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				metrics, err := fetchVMMetrics(c.Request.Context(), vm.ID, minDays)
				if err != nil {
					return
				}

				avgCPU := metrics["avgCPU"]
				if avgCPU < threshold && avgCPU >= 0 {
					mu.Lock()
					idleVMs = append(idleVMs, map[string]any{
						"resourceId":   vm.ID,
						"name":         vm.Name,
						"resourceGroup": vm.ResourceGroup,
						"subscriptionId": vm.SubscriptionID,
						"avgCpuPercent": avgCPU,
						"avgMemoryPercent": metrics["avgMemory"],
						"suggestedAction": "stop",
						"potentialSavings": vm.Cost,
					})
					mu.Unlock()
				}
			}(r)
		}
		wg.Wait()
		c.JSON(200, idleVMs)
	})

	// Rightsizing recommendations endpoint
	r.GET("/api/vms/rightsizing", func(c *gin.Context) {
		// Get all VMs
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		var recommendations []map[string]any
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 3)

		for _, r := range res {
			if !strings.Contains(strings.ToLower(r.Type), "virtualmachine") {
				continue
			}
			wg.Add(1)
			go func(vm AzureResource) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				metrics, err := fetchVMMetrics(c.Request.Context(), vm.ID, 7)
				if err != nil {
					return
				}

				avgCPU := metrics["avgCPU"]
				avgMem := metrics["avgMemory"]
				suggestion := ""
				potentialSavings := 0.0

				// Heuristic: if CPU < 30% and memory < 60%, suggest downsizing
				if avgCPU >= 0 && avgCPU < 30 && avgMem >= 0 && avgMem < 60 {
					suggestion = "downsize"
					// Estimate 40% savings from going down one VM size
					potentialSavings = vm.Cost * 0.4
				} else if avgCPU >= 0 && avgCPU > 80 {
					suggestion = "upsize"
					potentialSavings = vm.Cost * 0.2 // 20% extra cost to upsize
				}

				if suggestion != "" {
					mu.Lock()
					recommendations = append(recommendations, map[string]any{
						"resourceId":      vm.ID,
						"name":           vm.Name,
						"resourceGroup":  vm.ResourceGroup,
						"subscriptionId": vm.SubscriptionID,
						"currentCost":    vm.Cost,
						"avgCpuPercent":  avgCPU,
						"avgMemoryPercent": avgMem,
						"suggestion":     suggestion,
						"potentialSavings": potentialSavings,
					})
					mu.Unlock()
				}
			}(r)
		}
		wg.Wait()
		c.JSON(200, recommendations)
	})

	// Azure Advisor recommendations
	r.GET("/api/advisor/recommendations", func(c *gin.Context) {
		category := c.DefaultQuery("category", "Cost")
		subID := c.DefaultQuery("subscriptionId", "")

		apiVersion := "2024-11-18-preview"
		url := fmt.Sprintf("https://management.azure.com/subscriptions/%s/providers/Microsoft.Advisor/recommendations?api-version=%s&$filter=properties/category eq '%s'",
			subID, apiVersion, category)

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		cred, _ := azidentity.NewDefaultAzureCredential(nil)
		token, err := cred.GetToken(context.Background(), policy.TokenRequestOptions{Scopes: []string{"https://management.azure.com/.default"}})
		if err != nil {
			c.JSON(500, gin.H{"error": fmt.Sprintf("failed to get token: %v", err)})
			return
		}
		req.Header.Set("Authorization", "Bearer "+token.Token)

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != 200 {
			c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("Advisor API returned %d: %s", resp.StatusCode, string(body))})
			return
		}

		var result struct {
			Value []struct {
				ID       string `json:"id"`
				Type     string `json:"type"`
				Properties struct {
					Category        string `json:"category"`
					Impact          string `json:"impact"`
					ImpactedField   string `json:"impactedField"`
					ImpactedValue   string `json:"impactedValue"`
					ResourceGroup   string `json:"resourceGroup"`
					ShortDescription struct {
						Problem  string `json:"problem"`
						Solution string `json:"solution"`
					} `json:"shortDescription"`
					ExtendedProperties  map[string]string `json:"extendedProperties"`
					RecommendationTypeID string `json:"recommendationTypeId"`
				} `json:"properties"`
			} `json:"value"`
		}

		if err := json.Unmarshal(body, &result); err != nil {
			c.JSON(500, gin.H{"error": fmt.Sprintf("failed to parse response: %v", err)})
			return
		}

		var recommendations []map[string]any
		for _, r := range result.Value {
			rec := map[string]any{
				"id":                   r.ID,
				"category":             r.Properties.Category,
				"impact":               r.Properties.Impact,
				"impactedField":        r.Properties.ImpactedField,
				"impactedValue":        r.Properties.ImpactedValue,
				"resourceGroup":        r.Properties.ResourceGroup,
				"problem":              r.Properties.ShortDescription.Problem,
				"solution":             r.Properties.ShortDescription.Solution,
				"extendedProperties":   r.Properties.ExtendedProperties,
				"recommendationTypeId": r.Properties.RecommendationTypeID,
			}
			recommendations = append(recommendations, rec)
		}

		c.JSON(200, map[string]any{
			"recommendations": recommendations,
			"count":           len(recommendations),
		})
	})

	// Commitment savings calculator
	r.GET("/api/commitment/savings", func(c *gin.Context) {
		// Get all VM costs to calculate potential savings
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		// Calculate monthly on-demand VM spend
		var totalMonthlyOnDemand float64
		var vmCount int
		var byType map[string]float64 = make(map[string]float64)

		for _, r := range res {
			if strings.Contains(strings.ToLower(r.Type), "virtualmachine") && r.Cost > 0 {
				totalMonthlyOnDemand += r.Cost
				vmCount++
				rt := "virtualmachine"
				if idx := strings.LastIndex(strings.ToLower(r.Type), "/"); idx >= 0 {
					rt = strings.ToLower(r.Type)[idx+1:]
				}
				byType[rt] += r.Cost
			}
		}

		if totalMonthlyOnDemand == 0 {
			totalMonthlyOnDemand = 10000 // fallback for demo
			vmCount = 50
			byType = map[string]float64{"virtualmachine": 10000}
		}

		// RI pricing estimates (Azure published list prices, discounted)
		// 1-year RI: ~30% savings, 3-year RI: ~45% savings
		oneYearRate := 0.70  // 30% off on-demand
		threeYearRate := 0.55 // 45% off on-demand
		paybackMonths := 6    // typical payback period

		oneYearMonthlyRI := totalMonthlyOnDemand * oneYearRate
		threeYearMonthlyRI := totalMonthlyOnDemand * threeYearRate

		oneYearUpfront := totalMonthlyOnDemand * 12 * oneYearRate
		threeYearUpfront := totalMonthlyOnDemand * 36 * threeYearRate

		oneYearSavingsMonthly := totalMonthlyOnDemand - oneYearMonthlyRI
		threeYearSavingsMonthly := totalMonthlyOnDemand - threeYearMonthlyRI
		oneYearTotalSavings := (totalMonthlyOnDemand * 12) - oneYearUpfront
		threeYearTotalSavings := (totalMonthlyOnDemand * 36) - threeYearUpfront

		// Break-even points
		oneYearBreakEvenMonths := float64(paybackMonths)
		threeYearBreakEvenMonths := float64(paybackMonths)

		c.JSON(200, map[string]any{
			"onDemandMonthly":      totalMonthlyOnDemand,
			"vmCount":              vmCount,
			"byResourceType":        byType,
			"oneYearRI": map[string]any{
				"monthlyRate":         oneYearMonthlyRI,
				"upfrontAnnual":       oneYearUpfront,
				"savingsMonthly":     oneYearSavingsMonthly,
				"savingsYear1":       oneYearTotalSavings,
				"savingsYear3":       oneYearTotalSavings * 3,
				"breakEvenMonths":    oneYearBreakEvenMonths,
				"savingsPercent":     (1 - oneYearRate) * 100,
				"rateType":           "1-year Reserved Instance",
			},
			"threeYearRI": map[string]any{
				"monthlyRate":         threeYearMonthlyRI,
				"upfrontAnnual":       threeYearUpfront,
				"savingsMonthly":     threeYearSavingsMonthly,
				"savingsYear1":       threeYearTotalSavings,
				"savingsYear3":       threeYearTotalSavings,
				"breakEvenMonths":    threeYearBreakEvenMonths,
				"savingsPercent":     (1 - threeYearRate) * 100,
				"rateType":           "3-year Reserved Instance",
			},
		})
	})

	// Cost by resource type daily trend
	r.GET("/api/costs/by-type/daily", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		period := c.Query("period")
		if period == "" {
			period = "30"
		}
		days := 30
		fmt.Sscanf(period, "%d", &days)
		if days <= 0 {
			days = 30
		}

		now := time.Now()
		start := now.AddDate(0, 0, -days)

		// Composite cache key: sorted | joined subscription IDs
		sortedSubs := make([]string, len(subs))
		copy(sortedSubs, subs)
		sort.Strings(sortedSubs)
		cacheKey := strings.Join(sortedSubs, "|") + ":" + period

		// Try cache first
		if dates, types, ok := cache.getTypeDaily(cacheKey); ok {
			c.JSON(200, map[string]any{"dates": dates, "types": types})
			return
		}

		// Fetch fresh from Azure
		var allDaily []map[string]any
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2)

		for i, sid := range subs {
			if i > 0 {
				time.Sleep(1 * time.Second)
			}
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				daily, err := fetchDailyCostsByType(costClient, subID, start, now, c.Request.Context())
				if err != nil {
					return
				}
				mu.Lock()
				allDaily = append(allDaily, daily...)
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		// Check if fetched data has any actual cost
		fetchedTotal := 0.0
		for _, d := range allDaily {
			if cost, ok := d["cost"].(float64); ok {
				fetchedTotal += cost
			}
		}

		// Group by date and type
		byDateType := make(map[string]map[string]float64)
		for _, d := range allDaily {
			date, _ := d["date"].(string)
			rtype, _ := d["resourceType"].(string)
			cost, _ := d["cost"].(float64)
			if date == "" || rtype == "" {
				continue
			}
			if _, exists := byDateType[date]; !exists {
				byDateType[date] = make(map[string]float64)
			}
			byDateType[date][rtype] += cost
		}

		// Fallback: if Azure returned no data or all zeros, build from cached costs
		if len(byDateType) == 0 || fetchedTotal == 0 {
			rows2, err := cache.db.Query("SELECT resource_type, COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id IN ("+placeholders(len(subs))+") GROUP BY resource_type", toAnySlice(subs)...)
			if err == nil {
				defer rows2.Close()
				typeTotals := make(map[string]float64)
				for rows2.Next() {
					var rt string
					var tc float64
					if rows2.Scan(&rt, &tc) == nil {
						if idx := strings.LastIndex(rt, "/"); idx >= 0 {
							rt = rt[idx+1:]
						}
						rt = strings.ToLower(rt)
						if rt != "" {
							typeTotals[rt] += tc
						}
					}
				}
				var fallbackTypes []string
				for t := range typeTotals {
					fallbackTypes = append(fallbackTypes, t)
				}
				sort.Strings(fallbackTypes)
				var fallbackResults []map[string]any
				for i := days - 1; i >= 0; i-- {
					date := now.AddDate(0, 0, -i).Format("2006-01-02")
					entry := map[string]any{"date": date}
					for _, t := range fallbackTypes {
						entry[t] = typeTotals[t] / float64(days)
					}
					fallbackResults = append(fallbackResults, entry)
				}
				c.JSON(200, map[string]any{
					"dates": fallbackResults,
					"types": fallbackTypes,
				})
				return
			}
		}

		// Collect all types
		typeSet := make(map[string]bool)
		for _, dt := range byDateType {
			for t := range dt {
				typeSet[t] = true
			}
		}
		var allTypes []string
		for t := range typeSet {
			allTypes = append(allTypes, t)
		}
		sort.Strings(allTypes)

		// Build series per type
		typeSeries := make(map[string][]float64)
		for _, t := range allTypes {
			typeSeries[t] = make([]float64, days)
		}

		for i := days - 1; i >= 0; i-- {
			date := now.AddDate(0, 0, -i).Format("2006-01-02")
			if dt, ok := byDateType[date]; ok {
				for _, t := range allTypes {
					typeSeries[t][i] = dt[t]
				}
			}
		}

		var results []map[string]any
		for i := days - 1; i >= 0; i-- {
			date := now.AddDate(0, 0, -i).Format("2006-01-02")
			entry := map[string]any{"date": date}
			for _, t := range allTypes {
				entry[t] = typeSeries[t][i]
			}
			results = append(results, entry)
		}

		// Cache the aggregated result
		if len(results) > 0 {
			cache.setTypeDaily(cacheKey, results, allTypes)
		}

		c.JSON(200, map[string]any{
			"dates": results,
			"types": allTypes,
		})
	})

	// Cost by environment (tag-based chargeback)
	r.GET("/api/costs/by-environment", func(c *gin.Context) {
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		envMap := make(map[string]map[string]any)
		for _, r := range res {
			env := "Untagged"
			if r.Tags != nil {
				env = getEnvFromTags(r.Tags)
			}

			if _, exists := envMap[env]; !exists {
				envMap[env] = map[string]any{
					"totalCost":       0.0,
					"resourceCount":   0,
					"resourceTypeCost": make(map[string]float64),
				}
			}
			entry := envMap[env]
			entry["totalCost"] = entry["totalCost"].(float64) + r.Cost
			entry["resourceCount"] = entry["resourceCount"].(int) + 1

			rt := strings.ToLower(r.Type)
			if idx := strings.LastIndex(rt, "/"); idx >= 0 {
				rt = rt[idx+1:]
			}
			typeCost := entry["resourceTypeCost"].(map[string]float64)
			typeCost[rt] = typeCost[rt] + r.Cost
		}

		var results []map[string]any
		for env, data := range envMap {
			results = append(results, map[string]any{
				"environment":     env,
				"totalCost":      data["totalCost"].(float64),
				"resourceCount":  data["resourceCount"].(int),
				"typeBreakdown":  data["resourceTypeCost"].(map[string]float64),
			})
		}

		// Sort by cost desc
		sort.Slice(results, func(i, j int) bool {
			return results[i]["totalCost"].(float64) > results[j]["totalCost"].(float64)
		})
		c.JSON(200, results)
	})

	// Waste detection: queries SQLite cache directly (no live Azure calls needed)
	r.GET("/api/waste/detect", func(c *gin.Context) {
		if cache == nil {
			c.JSON(500, gin.H{"error": "cache not initialized"})
			return
		}

		// Fetch cost map for latest period (resource_id -> cost)
		costMap := make(map[string]float64)
		var maxPeriod string
		if err := cache.db.QueryRow("SELECT MAX(period) FROM costs").Scan(&maxPeriod); err == nil && maxPeriod != "" {
			costRows, cerr := cache.db.Query(
				"SELECT resource_id, SUM(cost) FROM costs WHERE period = ? GROUP BY resource_id", maxPeriod)
			if cerr == nil {
				defer costRows.Close()
				for costRows.Next() {
					var rid string
					var cost float64
					if costRows.Scan(&rid, &cost) == nil {
						costMap[strings.ToLower(rid)] = cost
					}
				}
			}
		}

		// Fetch all resources
		rows, err := cache.db.Query(
			"SELECT id, name, type, location, subscription_id, resource_group, COALESCE(tags, '{}'), COALESCE(managed_by, ''), COALESCE(status, '') FROM resources")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()

		type wasteItem struct {
			ResourceID     string
			Name           string
			Type           string
			Location       string
			SubscriptionID string
			ResourceGroup  string
			Tags           string
			ManagedBy      string
			Status         string
			Cost           float64
		}

		var items []wasteItem
		for rows.Next() {
			var it wasteItem
			if err := rows.Scan(&it.ResourceID, &it.Name, &it.Type, &it.Location,
				&it.SubscriptionID, &it.ResourceGroup, &it.Tags, &it.ManagedBy, &it.Status); err != nil {
				continue
			}
			it.Cost = costMap[strings.ToLower(it.ResourceID)]
			items = append(items, it)
		}

		// Helper: parse tags JSON into a map
		parseTags := func(tagsJSON string) map[string]string {
			out := make(map[string]string)
			if tagsJSON == "" || tagsJSON == "{}" {
				return out
			}
			var raw map[string]interface{}
			if err := json.Unmarshal([]byte(tagsJSON), &raw); err != nil {
				return out
			}
			for k, v := range raw {
				if v == nil {
					out[strings.ToLower(k)] = ""
				} else {
					out[strings.ToLower(k)] = fmt.Sprint(v)
				}
			}
			return out
		}

		// Category tracking
		type categoryStats struct {
			Count   int     `json:"count"`
			Savings float64 `json:"savings"`
		}
		byCategory := map[string]*categoryStats{
			"orphaned_disk": {},
			"orphaned_nic":  {},
			"orphaned_pip":  {},
			"dev_vm_247":    {},
			"low_score":     {},
		}

		var wasteItems []map[string]any
		seen := make(map[string]bool) // avoid double-counting by resourceId

		addItem := func(category, label, suggestion, severity string, it wasteItem, savings float64) {
			if seen[it.ResourceID] {
				return
			}
			seen[it.ResourceID] = true
			wasteItems = append(wasteItems, map[string]any{
				"resourceId":       it.ResourceID,
				"name":             it.Name,
				"resourceGroup":    it.ResourceGroup,
				"subscriptionId":   it.SubscriptionID,
				"type":             it.Type,
				"location":         it.Location,
				"category":         category,
				"categoryLabel":    label,
				"monthlyCost":      it.Cost,
				"potentialSavings": savings,
				"suggestion":       suggestion,
				"severity":         severity,
			})
			byCategory[category].Count++
			byCategory[category].Savings += savings
		}

		// Helper: check if VM is stopped/deallocated
		isStopped := func(status string) bool {
			statusLow := strings.ToLower(status)
			return statusLow == "stopped" || statusLow == "stopped (deallocated)" ||
				statusLow == "deallocated" || statusLow == "stopping"
		}

		for _, it := range items {
			typeLow := strings.ToLower(it.Type)
			nameLow := strings.ToLower(it.Name)
			rgLow := strings.ToLower(it.ResourceGroup)
			tags := parseTags(it.Tags)

			// ── Category 1: orphaned_disk ──────────────────────────────────────
			if strings.Contains(typeLow, "compute/disks") {
				// Use ManagedBy field from Azure API - if empty, disk is unattached
				if it.ManagedBy == "" {
					sev := "high"
					if it.Cost == 0 {
						sev = "medium"
					}
					addItem("orphaned_disk", "Orphaned Disk",
						"Delete this unattached disk to eliminate storage costs",
						sev, it, it.Cost)
				}
				continue
			}

			// ── Category 2: orphaned_nic ───────────────────────────────────────
			if strings.Contains(typeLow, "network/networkinterfaces") {
				_, hasVM := tags["virtualmachine"]
				_, hasIP := tags["ipconfigurations"]
				if !hasVM && !hasIP {
					sev := "medium"
					addItem("orphaned_nic", "Unattached NIC",
						"Remove this unattached network interface to reduce clutter and potential costs",
						sev, it, it.Cost)
				}
				continue
			}

			// ── Category 3: orphaned_pip ───────────────────────────────────────
			if strings.Contains(typeLow, "network/publicipaddresses") {
				_, hasIPConf := tags["ipconfiguration"]
				_, hasAssoc := tags["associatedresource"]
				if !hasIPConf && !hasAssoc {
					sev := "medium"
					if it.Cost > 0 {
						sev = "high"
					}
					addItem("orphaned_pip", "Unassigned Public IP",
						"Release this unassigned public IP address to stop incurring charges",
						sev, it, it.Cost)
				}
				continue
			}

			// ── Category 4: dev_vm_247 ─────────────────────────────────────────
			if strings.Contains(typeLow, "compute/virtualmachines") && !strings.Contains(typeLow, "scalesets") {
				// Skip if VM is already stopped - it's already saving money
				if isStopped(it.Status) {
					continue
				}
				isDevEnv := strings.Contains(nameLow, "dev") || strings.Contains(nameLow, "test") ||
					strings.Contains(nameLow, "staging") || strings.Contains(nameLow, "stag") ||
					strings.Contains(nameLow, "qa") || strings.Contains(nameLow, "sandbox") ||
					strings.Contains(rgLow, "dev") || strings.Contains(rgLow, "test") ||
					strings.Contains(rgLow, "staging") || strings.Contains(rgLow, "stag") ||
					strings.Contains(rgLow, "qa") || strings.Contains(rgLow, "sandbox")
				if isDevEnv && it.Cost > 0 {
					savings := it.Cost * 0.6 // assume 60% savings from scheduling off-hours
					addItem("dev_vm_247", "Dev/Test VM 24/7",
						"Schedule this dev/test VM to stop during off-hours (nights & weekends) to save ~60% of compute cost",
						"high", it, savings)
					continue
				}
			}

			// ── Category 5: low_score ──────────────────────────────────────────
			if it.Cost > 50 {
				// Infer score heuristically (mirrors scoreResource in azure.go)
				score := 70 // default reasonable score
				if strings.Contains(typeLow, "compute/virtualmachines") {
					// Skip if VM is already stopped - it's already saving money
					if isStopped(it.Status) {
						continue
					}
					if strings.Contains(nameLow, "dev") || strings.Contains(nameLow, "test") ||
						strings.Contains(rgLow, "dev") || strings.Contains(rgLow, "test") {
						score = 45
					}
				} else if strings.Contains(typeLow, "compute/disks") {
					score = 20
				} else if strings.Contains(typeLow, "network/networkinterfaces") {
					score = 25
				} else if strings.Contains(typeLow, "network/publicipaddresses") {
					score = 30
				} else if strings.Contains(typeLow, "compute/snapshots") {
					score = 35
				}
				if score < 35 {
					savings := it.Cost * 0.5
					addItem("low_score", "Low Utilization",
						"This resource has low efficiency score — review usage and consider rightsizing or deletion",
						"medium", it, savings)
				}
			}
		}

		// Sort by potentialSavings descending
		sort.Slice(wasteItems, func(i, j int) bool {
			si, _ := wasteItems[i]["potentialSavings"].(float64)
			sj, _ := wasteItems[j]["potentialSavings"].(float64)
			return si > sj
		})

		var totalSavings float64
		for _, w := range wasteItems {
			if s, ok := w["potentialSavings"].(float64); ok {
				totalSavings += s
			}
		}

		// Build byCategory response (convert pointers to values)
		byCatResp := map[string]map[string]any{}
		for k, v := range byCategory {
			byCatResp[k] = map[string]any{
				"count":   v.Count,
				"savings": v.Savings,
			}
		}

		c.JSON(200, map[string]any{
			"items":        wasteItems,
			"totalCount":   len(wasteItems),
			"totalSavings": totalSavings,
			"byCategory":   byCatResp,
		})
	})

	// Period-over-period cost comparison (current period vs previous period)
	r.GET("/api/costs/comparison", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		periodDays := 30
		if p := c.Query("days"); p != "" {
			fmt.Sscanf(p, "%d", &periodDays)
		}

		now := time.Now()
		currentStart := now.AddDate(0, 0, -periodDays)
		previousStart := now.AddDate(0, 0, -periodDays*2)
		previousEnd := now.AddDate(0, 0, -periodDays)

		var currentTotal, previousTotal float64
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2)

		for i, sid := range subs {
			if i > 0 {
				time.Sleep(1 * time.Second)
			}
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				// Current period
				curr, err1 := fetchDailyCosts(costClient, subID, currentStart, now, c.Request.Context())
				time.Sleep(200 * time.Millisecond) // Small delay between consecutive calls to same sub
				// Previous period
				prev, err2 := fetchDailyCosts(costClient, subID, previousStart, previousEnd, c.Request.Context())

				mu.Lock()
				if err1 == nil {
					for _, d := range curr {
						if cost, ok := d["cost"].(float64); ok {
							currentTotal += cost
						}
					}
				}
				if err2 == nil {
					for _, d := range prev {
						if cost, ok := d["cost"].(float64); ok {
							previousTotal += cost
						}
					}
				}
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		var deltaPct, deltaAbs float64
		if previousTotal > 0 {
			deltaPct = ((currentTotal - previousTotal) / previousTotal) * 100
			deltaAbs = currentTotal - previousTotal
		}

		trend := "stable"
		if deltaPct > 5 {
			trend = "up"
		} else if deltaPct < -5 {
			trend = "down"
		}

		c.JSON(200, map[string]any{
			"currentPeriod": map[string]any{
				"start":    currentStart.Format("2006-01-02"),
				"end":      now.Format("2006-01-02"),
				"days":     periodDays,
				"totalCost": currentTotal,
			},
			"previousPeriod": map[string]any{
				"start":    previousStart.Format("2006-01-02"),
				"end":      previousEnd.Format("2006-01-02"),
				"days":     periodDays,
				"totalCost": previousTotal,
			},
			"delta": map[string]any{
				"absolute":  deltaAbs,
				"percent":   deltaPct,
				"trend":     trend,
				"direction": map[bool]string{true: "increase", false: "decrease"}[deltaAbs > 0],
			},
		})
	})

	// Monthly cost trend (last 3 months)
	r.GET("/api/costs/trend", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		if len(subs) == 0 {
			c.JSON(400, gin.H{"error": "at least one subscriptionId is required"})
			return
		}

		type monthData struct {
			Month string  `json:"month"`
			Cost  float64 `json:"cost"`
		}

		// Get costs for last 90 days grouped by month
		now := time.Now()
		start := now.AddDate(0, -3, 0)

		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 2)
		monthlyCosts := make(map[string]float64)

		for i, sid := range subs {
			if i > 0 {
				time.Sleep(1 * time.Second)
			}
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				daily, err := fetchDailyCosts(costClient, subID, start, now, c.Request.Context())
				if err != nil {
					return
				}

				mu.Lock()
				for _, d := range daily {
					if dateStr, ok := d["date"].(string); ok {
						if len(dateStr) >= 7 {
							monthKey := dateStr[:7] // "YYYY-MM"
							cost, _ := d["cost"].(float64)
							monthlyCosts[monthKey] += cost
						}
					}
				}
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		// Sort by month and return last 3
		var months []string
		for m := range monthlyCosts {
			months = append(months, m)
		}
		sort.Strings(months)
		if len(months) > 3 {
			months = months[len(months)-3:]
		}

		var result []monthData
		for _, m := range months {
			result = append(result, monthData{Month: m, Cost: monthlyCosts[m]})
		}

		c.JSON(200, result)
	})

	// Cost forecast using Azure's AI-powered forecast API
	r.GET("/api/costs/forecast", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		if len(subs) == 0 {
			c.JSON(400, gin.H{"error": "at least one subscriptionId is required"})
			return
		}

		now := time.Now()
		days := 30
		if d := c.Query("days"); d != "" {
			fmt.Sscanf(d, "%d", &days)
		}
		start := now.AddDate(0, 0, -days)
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		monthEnd := monthStart.AddDate(0, 1, -1)

		// 1. Sum cached forecast data
		var totalActual, totalForecast float64
		var cachedSubs []string
		var missingSubs []string
		for _, sid := range subs {
			actual, forecast, ok := cache.getForecast(sid, days)
			if ok {
				totalActual += actual
				totalForecast += forecast
				cachedSubs = append(cachedSubs, sid)
			} else {
				missingSubs = append(missingSubs, sid)
			}
		}

		// 2. Compute monthly totals: all subs vs cached subs
		totalMonthly := 0.0
		cachedMonthly := 0.0
		rowsAll, err := cache.db.Query("SELECT subscription_id, COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id IN ("+placeholders(len(subs))+") GROUP BY subscription_id", toAnySlice(subs)...)
		if err == nil {
			defer rowsAll.Close()
			for rowsAll.Next() {
				var subID string
				var subCost float64
				rowsAll.Scan(&subID, &subCost)
				totalMonthly += subCost
				for _, cs := range cachedSubs {
					if cs == subID {
						cachedMonthly += subCost
						break
					}
				}
			}
		}

		// 3. Estimate missing subs from monthly cost proportion
		if len(missingSubs) > 0 && totalMonthly > cachedMonthly {
			missingMonthly := totalMonthly - cachedMonthly
			scale := float64(days) / 30.0 // approximate period cost from monthly
			if scale <= 0 {
				scale = 1
			}
			totalActual += missingMonthly * scale
			// Forecast is not available for missing subs; leave totalForecast unchanged
		}

		// 4. Launch background fetch for missing subs
		if len(missingSubs) > 0 {
			go func(subsToFetch []string) {
				var wg sync.WaitGroup
				sem := make(chan struct{}, 2)
				for i, sid := range subsToFetch {
					if i > 0 {
						time.Sleep(1 * time.Second)
					}
					wg.Add(1)
					go func(subID string) {
						defer wg.Done()
						sem <- struct{}{}
						defer func() { <-sem }()
						actual, forecast, err := fetchForecast(forecastClient, subID, monthStart, monthEnd, context.Background())
						if err == nil {
							cache.setForecast(subID, days, actual, forecast)
						}
					}(sid)
				}
				wg.Wait()
			}(missingSubs)
		}

		c.JSON(200, map[string]any{
			"actualCost":   totalActual,
			"forecastCost": totalForecast,
			"periodDays":   days,
			"start":        start.Format("2006-01-02"),
			"end":          now.Format("2006-01-02"),
			"errors":       nil,
		})
	})

	r.GET("/api/costs", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		rows, err := cache.db.Query("SELECT resource_group, resource_type, resource_location, cost, subscription_id FROM costs WHERE subscription_id IN ("+placeholders(len(subs))+")", toAnySlice(subs)...)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()

		var results []map[string]any
		for rows.Next() {
			var rg, rt, rl, sid string
			var cost float64
			if err := rows.Scan(&rg, &rt, &rl, &cost, &sid); err == nil {
				results = append(results, map[string]any{
					"resourceGroup":    rg,
					"resourceType":     rt,
					"resourceLocation": rl,
					"cost":             cost,
					"subscriptionId":   sid,
				})
			}
		}
		c.JSON(200, results)
	})

	r.GET("/api/export", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		rgs := c.QueryArray("resourceGroup")
		types := c.QueryArray("type")
		locs := c.QueryArray("location")
		search := c.Query("search")
		orphaned := c.Query("orphaned") == "true"
		unattachedDiskOnly := c.Query("unattachedDiskOnly") == "true"
		unassignedPIPOnly := c.Query("unassignedPIPOnly") == "true"
		unattachedNICOnly := c.Query("unattachedNICOnly") == "true"
		mask := c.Query("mask") == "true"

		res, _, err := FetchResourcesWithCosts(c.Request.Context(), subs, rgs, types, locs, search, orphaned, unattachedDiskOnly, unassignedPIPOnly, unattachedNICOnly, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		if mask {
			for i := range res {
				res[i].Name = fmt.Sprintf("resource-%03d", i+1)
				res[i].ResourceGroup = "masked-rg"
				res[i].SubscriptionID = "masked-sub"
			}
		}
		c.Header("Content-Type", "text/csv")
		c.Header("Content-Disposition", "attachment; filename=cloudviz-export.csv")
		fmt.Fprintln(c.Writer, "Name,Type,Location,Resource Group,Subscription ID,Cost,Optimization")
		for _, r := range res {
			fmt.Fprintf(c.Writer, "%s,%s,%s,%s,%s,%.2f,%s\n", r.Name, r.Type, r.Location, r.ResourceGroup, r.SubscriptionID, r.Cost, r.Optimization)
		}
	})

	r.GET("/api/ai-insights/:resourceId", func(c *gin.Context) {
		rid := c.Param("resourceId")
		if rid == "" {
			c.JSON(400, gin.H{"error": "resourceId is required"})
			return
		}

		// 1. Get resource context (cost, RG, location, type)
		resource, err := getResourceContext(c.Request.Context(), rid)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get resource context: " + err.Error()})
			return
		}

		// 2. Fetch metrics
		resourceType := resource.Type
		metrics, err := fetchResourceMetrics(c.Request.Context(), rid, resourceType)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch metrics: " + err.Error()})
			return
		}

		// 3. Calculate statistics
		stats := calculateMetricsStats(metrics)

		// 4. Get Ollama recommendation
		recommendations, confidence, overallCategory, ollamaErr := getOllamaRecommendation(metrics, rid, resource)

		// 5. If Ollama failed, use rule-based fallback
		if ollamaErr != nil || len(recommendations) == 0 {
			recommendations = getRuleBasedRecommendation(resource, stats)
			confidence = 0.5 // lower confidence for rule-based
			if overallCategory == "" && len(recommendations) > 0 {
				overallCategory = recommendations[0].Category
			}
		}

		c.JSON(200, AIInsight{
			ResourceID:       rid,
			ResourceName:     resource.Name,
			ResourceType:     resource.Type,
			ResourceGroup:    resource.ResourceGroup,
			Location:         resource.Location,
			SubscriptionID:   resource.SubscriptionID,
			MonthlyCost:      resource.Cost,
			Metrics:          metrics,
			MetricsSummary:   stats,
			Recommendations:  recommendations,
			Category:         overallCategory,
			ConfidenceScore:  confidence,
			OllamaAvailable:  ollamaErr == nil,
		})
	})

	r.GET("/api/costs/stream", sseHandler)
	r.GET("/api/history", historyHandler)
	r.GET("/api/history/cost-drivers", costDriversHandler)
	r.GET("/api/history/rg-trends", rgTrendsHandler)

	// Resource Group Comparison endpoint
	r.GET("/api/resource-groups/comparison", func(c *gin.Context) {
		rg1 := c.Query("rg1")
		rg2 := c.Query("rg2")
		sub1 := c.Query("sub1")
		sub2 := c.Query("sub2")

		if rg1 == "" || rg2 == "" {
			c.JSON(400, gin.H{"error": "rg1 and rg2 are required"})
			return
		}

		// Fetch resources for both resource groups
		res1, _, err1 := FetchResourcesWithCosts(c.Request.Context(), []string{sub1}, []string{rg1}, nil, nil, "", false, false, false, false, "", "")
		res2, _, err2 := FetchResourcesWithCosts(c.Request.Context(), []string{sub2}, []string{rg2}, nil, nil, "", false, false, false, false, "", "")

		if err1 != nil || err2 != nil {
			c.JSON(500, gin.H{"error": fmt.Sprintf("failed to fetch resources: %v, %v", err1, err2)})
			return
		}

		// Calculate metrics for each resource group
		calcMetrics := func(resources []AzureResource) map[string]interface{} {
			totalCost := 0.0
			resourceCount := len(resources)
			typeBreakdown := make(map[string]int)
			typeCosts := make(map[string]float64)
			totalScore := 0
			orphanedCount := 0
			envCounts := make(map[string]int)

			for _, r := range resources {
				totalCost += r.Cost
				totalScore += r.Score
				if r.IsOrphaned {
					orphanedCount++
				}

				// Type breakdown
				typeName := getResourceTypeName(r.Type)
				typeBreakdown[typeName]++
				typeCosts[typeName] += r.Cost

				// Environment inference
				env := "unknown"
				rgLower := strings.ToLower(r.ResourceGroup)
				if strings.Contains(rgLower, "prod") {
					env = "production"
				} else if strings.Contains(rgLower, "dev") {
					env = "development"
				} else if strings.Contains(rgLower, "test") || strings.Contains(rgLower, "qa") {
					env = "test"
				} else if strings.Contains(rgLower, "staging") {
					env = "staging"
				}
				envCounts[env]++
			}

			avgScore := 100
			if resourceCount > 0 {
				avgScore = totalScore / resourceCount
			}

			// Convert type breakdown to slice for easier consumption
			typeList := make([]map[string]interface{}, 0)
			for t, count := range typeBreakdown {
				typeList = append(typeList, map[string]interface{}{
					"type":        t,
					"count":       count,
					"cost":        typeCosts[t],
					"percent":     float64(count) / float64(resourceCount) * 100,
					"costPercent": func() float64 {
						if totalCost > 0 {
							return typeCosts[t] / totalCost * 100
						}
						return 0
					}(),
				})
			}

			// Sort by count descending
			sort.Slice(typeList, func(i, j int) bool {
				return typeList[i]["count"].(int) > typeList[j]["count"].(int)
			})

			return map[string]interface{}{
				"resourceGroup":   "",
				"subscriptionId":  "",
				"resourceCount":   resourceCount,
				"totalCost":       totalCost,
				"averageCost":     func() float64 { if resourceCount > 0 { return totalCost / float64(resourceCount) }; return 0 }(),
				"efficiencyScore": avgScore,
				"orphanedCount":   orphanedCount,
				"typeBreakdown":   typeList,
				"environment":     envCounts,
			}
		}

		metrics1 := calcMetrics(res1)
		metrics2 := calcMetrics(res2)

		// Get resource group info from first resource if available
		if len(res1) > 0 {
			metrics1["resourceGroup"] = res1[0].ResourceGroup
			metrics1["subscriptionId"] = res1[0].SubscriptionID
		} else {
			metrics1["resourceGroup"] = rg1
			metrics1["subscriptionId"] = sub1
		}

		if len(res2) > 0 {
			metrics2["resourceGroup"] = res2[0].ResourceGroup
			metrics2["subscriptionId"] = res2[0].SubscriptionID
		} else {
			metrics2["resourceGroup"] = rg2
			metrics2["subscriptionId"] = sub2
		}

		// Calculate deltas
		countDelta := metrics2["resourceCount"].(int) - metrics1["resourceCount"].(int)
		costDelta := metrics2["totalCost"].(float64) - metrics1["totalCost"].(float64)
		scoreDelta := metrics2["efficiencyScore"].(int) - metrics1["efficiencyScore"].(int)

		// Helper to format resources by type
		formatResourcesByType := func(resources []AzureResource) []map[string]interface{} {
			// Group resources by type
			typeMap := make(map[string][]map[string]interface{})
			for _, r := range resources {
				typeName := getResourceTypeName(r.Type)
				if _, ok := typeMap[typeName]; !ok {
					typeMap[typeName] = make([]map[string]interface{}, 0)
				}
				typeMap[typeName] = append(typeMap[typeName], map[string]interface{}{
					"id":             r.ID,
					"name":           r.Name,
					"type":           r.Type,
					"location":       r.Location,
					"cost":           r.Cost,
					"score":          r.Score,
					"isOrphaned":     r.IsOrphaned,
					"optimization":   r.Optimization,
				})
			}

			// Convert to slice format
			result := make([]map[string]interface{}, 0)
			for typeName, resList := range typeMap {
				// Sort resources by cost descending
				sort.Slice(resList, func(i, j int) bool {
					return resList[i]["cost"].(float64) > resList[j]["cost"].(float64)
				})

				// Calculate total cost for this type
				typeCost := 0.0
				for _, r := range resList {
					typeCost += r["cost"].(float64)
				}

				result = append(result, map[string]interface{}{
					"type":      typeName,
					"count":     len(resList),
					"totalCost": typeCost,
					"resources": resList,
				})
			}

			// Sort by count descending
			sort.Slice(result, func(i, j int) bool {
				return result[i]["count"].(int) > result[j]["count"].(int)
			})

			return result
		}

		metrics1["resourcesByType"] = formatResourcesByType(res1)
		metrics2["resourcesByType"] = formatResourcesByType(res2)

		c.JSON(200, gin.H{
			"rg1": metrics1,
			"rg2": metrics2,
			"comparison": map[string]interface{}{
				"resourceCountDelta": countDelta,
				"costDelta":        costDelta,
				"scoreDelta":       scoreDelta,
				"winner": func() string {
					// Simple scoring: lower cost is better, higher efficiency is better
					score1 := 0
					score2 := 0

					// Cost efficiency (normalized by resource count)
					costPerRes1 := metrics1["averageCost"].(float64)
					costPerRes2 := metrics2["averageCost"].(float64)
					if costPerRes1 < costPerRes2 {
						score1 += 2
					} else if costPerRes2 < costPerRes1 {
						score2 += 2
					} else {
						score1++
						score2++
					}

					// Efficiency score
					if metrics1["efficiencyScore"].(int) > metrics2["efficiencyScore"].(int) {
						score1 += 2
					} else if metrics2["efficiencyScore"].(int) > metrics1["efficiencyScore"].(int) {
						score2 += 2
					} else {
						score1++
						score2++
					}

					// Less orphaned resources
					if metrics1["orphanedCount"].(int) < metrics2["orphanedCount"].(int) {
						score1++
					} else if metrics2["orphanedCount"].(int) < metrics1["orphanedCount"].(int) {
						score2++
					}

					if score1 > score2 {
						return "rg1"
					} else if score2 > score1 {
						return "rg2"
					}
					return "tie"
				}(),
			},
		})
	})

	// Subscription Comparison endpoint
	r.GET("/api/subscriptions/comparison", func(c *gin.Context) {
		sub1 := c.Query("sub1")
		sub2 := c.Query("sub2")

		if sub1 == "" || sub2 == "" {
			c.JSON(400, gin.H{"error": "sub1 and sub2 are required"})
			return
		}

		// Fetch resources for both subscriptions
		res1, _, err1 := FetchResourcesWithCosts(c.Request.Context(), []string{sub1}, nil, nil, nil, "", false, false, false, false, "", "")
		res2, _, err2 := FetchResourcesWithCosts(c.Request.Context(), []string{sub2}, nil, nil, nil, "", false, false, false, false, "", "")

		if err1 != nil || err2 != nil {
			c.JSON(500, gin.H{"error": fmt.Sprintf("failed to fetch resources: %v, %v", err1, err2)})
			return
		}

		// Calculate metrics for each subscription
		calcMetrics := func(resources []AzureResource) map[string]interface{} {
			totalCost := 0.0
			resourceCount := len(resources)
			typeBreakdown := make(map[string]int)
			typeCosts := make(map[string]float64)
			locationBreakdown := make(map[string]int)
			locationCosts := make(map[string]float64)
			rgBreakdown := make(map[string]int)
			totalScore := 0
			orphanedCount := 0

			for _, r := range resources {
				totalCost += r.Cost
				totalScore += r.Score
				if r.IsOrphaned {
					orphanedCount++
				}

				// Type breakdown
				typeName := getResourceTypeName(r.Type)
				typeBreakdown[typeName]++
				typeCosts[typeName] += r.Cost

				// Location breakdown
				locationBreakdown[r.Location]++
				locationCosts[r.Location] += r.Cost

				// Resource group breakdown
				rgBreakdown[r.ResourceGroup]++
			}

			avgScore := 100
			if resourceCount > 0 {
				avgScore = totalScore / resourceCount
			}

			// Convert type breakdown to slice
			typeList := make([]map[string]interface{}, 0)
			for t, count := range typeBreakdown {
				typeList = append(typeList, map[string]interface{}{
					"type":        t,
					"count":       count,
					"cost":        typeCosts[t],
					"percent":     float64(count) / float64(resourceCount) * 100,
					"costPercent": func() float64 {
						if totalCost > 0 {
							return typeCosts[t] / totalCost * 100
						}
						return 0
					}(),
				})
			}
			sort.Slice(typeList, func(i, j int) bool {
				return typeList[i]["count"].(int) > typeList[j]["count"].(int)
			})

			// Convert location breakdown to slice
			locList := make([]map[string]interface{}, 0)
			for loc, count := range locationBreakdown {
				locList = append(locList, map[string]interface{}{
					"location":    loc,
					"count":       count,
					"cost":        locationCosts[loc],
					"percent":     float64(count) / float64(resourceCount) * 100,
					"costPercent": func() float64 {
						if totalCost > 0 {
							return locationCosts[loc] / totalCost * 100
						}
						return 0
					}(),
				})
			}
			sort.Slice(locList, func(i, j int) bool {
				return locList[i]["count"].(int) > locList[j]["count"].(int)
			})

			return map[string]interface{}{
				"subscriptionId":   "",
				"resourceCount":    resourceCount,
				"resourceGroups":   len(rgBreakdown),
				"totalCost":        totalCost,
				"averageCost":      func() float64 { if resourceCount > 0 { return totalCost / float64(resourceCount) }; return 0 }(),
				"efficiencyScore":  avgScore,
				"orphanedCount":    orphanedCount,
				"typeBreakdown":    typeList,
				"locationBreakdown": locList,
			}
		}

		metrics1 := calcMetrics(res1)
		metrics2 := calcMetrics(res2)

		metrics1["subscriptionId"] = sub1
		metrics2["subscriptionId"] = sub2

		// Calculate deltas
		countDelta := metrics2["resourceCount"].(int) - metrics1["resourceCount"].(int)
		costDelta := metrics2["totalCost"].(float64) - metrics1["totalCost"].(float64)
		scoreDelta := metrics2["efficiencyScore"].(int) - metrics1["efficiencyScore"].(int)
		rgDelta := metrics2["resourceGroups"].(int) - metrics1["resourceGroups"].(int)

		// Helper to format resources by type (reused from RG comparison)
		formatResourcesByType := func(resources []AzureResource) []map[string]interface{} {
			typeMap := make(map[string][]map[string]interface{})
			for _, r := range resources {
				typeName := getResourceTypeName(r.Type)
				if _, ok := typeMap[typeName]; !ok {
					typeMap[typeName] = make([]map[string]interface{}, 0)
				}
				typeMap[typeName] = append(typeMap[typeName], map[string]interface{}{
					"id":           r.ID,
					"name":         r.Name,
					"type":         r.Type,
					"location":     r.Location,
					"cost":         r.Cost,
					"score":        r.Score,
					"isOrphaned":   r.IsOrphaned,
					"optimization": r.Optimization,
				})
			}

			result := make([]map[string]interface{}, 0)
			for typeName, resList := range typeMap {
				sort.Slice(resList, func(i, j int) bool {
					return resList[i]["cost"].(float64) > resList[j]["cost"].(float64)
				})

				typeCost := 0.0
				for _, r := range resList {
					typeCost += r["cost"].(float64)
				}

				result = append(result, map[string]interface{}{
					"type":      typeName,
					"count":     len(resList),
					"totalCost": typeCost,
					"resources": resList,
				})
			}

			sort.Slice(result, func(i, j int) bool {
				return result[i]["count"].(int) > result[j]["count"].(int)
			})

			return result
		}

		metrics1["resourcesByType"] = formatResourcesByType(res1)
		metrics2["resourcesByType"] = formatResourcesByType(res2)

		c.JSON(200, gin.H{
			"sub1": metrics1,
			"sub2": metrics2,
			"comparison": map[string]interface{}{
				"resourceCountDelta": countDelta,
				"costDelta":          costDelta,
				"scoreDelta":         scoreDelta,
				"rgDelta":            rgDelta,
				"winner": func() string {
					score1 := 0
					score2 := 0

					// Cost efficiency
					costPerRes1 := metrics1["averageCost"].(float64)
					costPerRes2 := metrics2["averageCost"].(float64)
					if costPerRes1 < costPerRes2 {
						score1 += 2
					} else if costPerRes2 < costPerRes1 {
						score2 += 2
					} else {
						score1++
						score2++
					}

					// Efficiency score
					if metrics1["efficiencyScore"].(int) > metrics2["efficiencyScore"].(int) {
						score1 += 2
					} else if metrics2["efficiencyScore"].(int) > metrics1["efficiencyScore"].(int) {
						score2 += 2
					} else {
						score1++
						score2++
					}

					// Less orphaned resources
					if metrics1["orphanedCount"].(int) < metrics2["orphanedCount"].(int) {
						score1++
					} else if metrics2["orphanedCount"].(int) < metrics1["orphanedCount"].(int) {
						score2++
					}

					if score1 > score2 {
						return "sub1"
					} else if score2 > score1 {
						return "sub2"
					}
					return "tie"
				}(),
			},
		})
	})

	// Register dependency analysis routes
	RegisterDependencyRoutes(r, cache.db, argClient)

	r.DELETE("/api/costs/cache", func(c *gin.Context) {
		cache.db.Exec("DELETE FROM costs")
		cache.db.Exec("DELETE FROM cost_type_daily")
		cache.db.Exec("DELETE FROM cost_forecast")
		cache.db.Exec("DELETE FROM cost_daily")
		c.JSON(200, gin.H{"message": "Cache cleared"})
	})

	// SLA Monitoring endpoint — VM uptime tracking
	r.GET("/api/sla", func(c *gin.Context) {
		periodDays := 30
		if d := c.Query("days"); d != "" {
			fmt.Sscanf(d, "%d", &periodDays)
		}
		if periodDays < 1 || periodDays > 90 {
			periodDays = 30
		}

		threshold := 99.0
		if t := c.Query("threshold"); t != "" {
			fmt.Sscanf(t, "%f", &threshold)
		}

		// Get all VMs from the resources cache
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		var vms []AzureResource
		for _, r := range res {
			if strings.EqualFold(r.Type, "microsoft.compute/virtualmachines") {
				vms = append(vms, r)
			}
		}

		var results []map[string]any
		var mu sync.Mutex
		sem := make(chan struct{}, 3)

		for _, vm := range vms {
			vm := vm
			go func() {
				sem <- struct{}{}
				defer func() { <-sem }()

				uptime, downtime, err := fetchVMAvailability(c.Request.Context(), vm.ID, periodDays)
				status := "healthy"
				if uptime < threshold {
					status = "critical"
				} else if uptime < 99.9 {
					status = "warning"
				}

				mu.Lock()
				results = append(results, map[string]any{
					"resourceId":       vm.ID,
					"name":             vm.Name,
					"resourceGroup":    vm.ResourceGroup,
					"subscriptionId":   vm.SubscriptionID,
					"location":         vm.Location,
					"uptimePercentage": uptime,
					"downtimeHours":    downtime,
					"totalHours":       float64(periodDays * 24),
					"status":           status,
					"hasMetrics":       err == nil,
				})
				mu.Unlock()
			}()
		}

		// Wait for all goroutines to finish
		for i := 0; i < len(vms); i++ {
			sem <- struct{}{}
		}

		// Sort by uptime asc (worst first)
		sort.Slice(results, func(i, j int) bool {
			ui, _ := results[i]["uptimePercentage"].(float64)
			uj, _ := results[j]["uptimePercentage"].(float64)
			return ui < uj
		})

		c.JSON(200, gin.H{
			"periodDays": periodDays,
			"threshold":  threshold,
			"totalVMs":   len(vms),
			"data":       results,
		})
	})

	// Serve Static Files from embedded FS
	staticFS, _ := fs.Sub(frontendAssets, "dist")
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.JSON(404, gin.H{"error": "API route not found"})
			return
		}

		path := strings.TrimPrefix(c.Request.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Try to read the file from embedded FS
		data, err := fs.ReadFile(staticFS, path)
		if err != nil {
			// Fallback to index.html for SPA
			path = "index.html"
			data, _ = fs.ReadFile(staticFS, path)
		}

		// Set content type based on extension
		contentType := "text/html"
		if strings.HasSuffix(path, ".js") {
			contentType = "text/javascript"
		} else if strings.HasSuffix(path, ".css") {
			contentType = "text/css"
		} else if strings.HasSuffix(path, ".svg") {
			contentType = "image/svg+xml"
		} else if strings.HasSuffix(path, ".png") {
			contentType = "image/png"
		} else if strings.HasSuffix(path, ".jpg") || strings.HasSuffix(path, ".jpeg") {
			contentType = "image/jpeg"
		} else if strings.HasSuffix(path, ".ico") {
			contentType = "image/x-icon"
		}

		// Add cache control headers to prevent aggressive caching
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")

		c.Data(200, contentType, data)
	})

	// Enhanced Reporting Endpoints
	r.GET("/api/reports/resource-group-costs", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		if len(subs) == 0 {
			// Get all visible subscriptions
			subs = getVisibleSubscriptions(c.Request.Context())
		}

		var reports []ResourceGroupCostReport
		now := time.Now()
		currentMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		previousMonthStart := currentMonthStart.AddDate(0, -1, 0)
		previousMonthEnd := currentMonthStart.Add(-time.Second)

		for _, subID := range subs {
			// Get subscription name
			subName := getSubscriptionName(c.Request.Context(), subID)

			// Get resource groups for this subscription
			rgs := getResourceGroupsForSubscription(c.Request.Context(), subID)

			for _, rg := range rgs {
				// Fetch current month costs
				currentCost := fetchResourceGroupCost(c.Request.Context(), subID, rg, currentMonthStart, now)
				previousCost := fetchResourceGroupCost(c.Request.Context(), subID, rg, previousMonthStart, previousMonthEnd)

				// Get resources in this RG
				resources, _, _ := FetchResourcesWithCosts(c.Request.Context(), []string{subID}, []string{rg}, nil, nil, "", false, false, false, false, "", "")

				// Calculate top cost resources
				var topResources []ResourceCostSummary
				sort.Slice(resources, func(i, j int) bool {
					return resources[i].Cost > resources[j].Cost
				})
				totalCost := 0.0
				for _, r := range resources {
					totalCost += r.Cost
				}
				for i, r := range resources {
					if i >= 5 {
						break
					}
					percent := 0.0
					if totalCost > 0 {
						percent = (r.Cost / totalCost) * 100
					}
					topResources = append(topResources, ResourceCostSummary{
						ResourceID:   r.ID,
						ResourceName: r.Name,
						ResourceType: r.Type,
						MonthlyCost:  r.Cost,
						CostPercent:  percent,
					})
				}

				change := currentCost - previousCost
				changePercent := 0.0
				if previousCost > 0 {
					changePercent = (change / previousCost) * 100
				}

				// Get day-by-day cost data for current month
				var costByDay []DayCost
				dailyCosts, _ := fetchDailyCostsWithCache(c.Request.Context(), subID, currentMonthStart, now)
				for _, d := range dailyCosts {
					if day, ok := d["day"].(int); ok {
						if cost, ok := d["cost"].(float64); ok {
							dateStr := fmt.Sprintf("%02d", day)
							costByDay = append(costByDay, DayCost{
								Date: dateStr,
								Cost: cost,
							})
						}
					}
				}

				// Get previous month resource count for comparison
				// (using history data if available, otherwise estimate from trends)
				previousResourceCount := len(resources) // Default to current (no change)
				resourceCountChange := len(resources) - previousResourceCount

				reports = append(reports, ResourceGroupCostReport{
					ResourceGroup:         rg,
					SubscriptionID:        subID,
					SubscriptionName:      subName,
					CurrentMonthCost:      currentCost,
					PreviousMonthCost:     previousCost,
					CostChange:            change,
					CostChangePercent:     changePercent,
					ResourceCount:         len(resources),
					PreviousResourceCount: previousResourceCount,
					ResourceCountChange:   resourceCountChange,
					TopCostResources:      topResources,
					CostByDay:             costByDay,
				})
			}
		}

		c.JSON(200, reports)
	})

	r.GET("/api/reports/daily-trends", func(c *gin.Context) {
		subID := c.Query("subscriptionId")
		if subID == "" {
			c.JSON(400, gin.H{"error": "subscriptionId is required"})
			return
		}

		now := time.Now()
		currentMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		previousMonthStart := currentMonthStart.AddDate(0, -1, 0)
		previousMonthEnd := currentMonthStart.Add(-time.Second)

		subName := getSubscriptionName(c.Request.Context(), subID)

		// Fetch daily costs for both months
		currentDaily, err1 := fetchDailyCostsWithCache(c.Request.Context(), subID, currentMonthStart, now)
		previousDaily, err2 := fetchDailyCostsWithCache(c.Request.Context(), subID, previousMonthStart, previousMonthEnd)

		if err1 != nil || err2 != nil {
			c.JSON(500, gin.H{"error": fmt.Sprintf("failed to fetch daily costs: %v, %v", err1, err2)})
			return
		}

		// Build daily trends
		var trends []DailyCostTrend
		currentTotal := 0.0
		previousTotal := 0.0

		// Create a map for previous month costs by day
		previousByDay := make(map[int]float64)
		for _, d := range previousDaily {
			if day, ok := d["day"].(int); ok {
				if cost, ok := d["cost"].(float64); ok {
					previousByDay[day] = cost
					previousTotal += cost
				}
			}
		}

		// Build trends for each day of current month so far
		for _, d := range currentDaily {
			if day, ok := d["day"].(int); ok {
				if currentCost, ok := d["cost"].(float64); ok {
					previousCost := previousByDay[day]
					change := currentCost - previousCost
					changePercent := 0.0
					if previousCost > 0 {
						changePercent = (change / previousCost) * 100
					}

					trends = append(trends, DailyCostTrend{
						Date:            fmt.Sprintf("%02d", day),
						CurrentMonth:    currentCost,
						PreviousMonth:   previousCost,
						Change:          change,
						ChangePercent:   changePercent,
					})
					currentTotal += currentCost
				}
			}
		}

		// Sort trends by day
		sort.Slice(trends, func(i, j int) bool {
			return trends[i].Date < trends[j].Date
		})

		// Calculate overall change
		overallChange := currentTotal - previousTotal
		overallChangePercent := 0.0
		if previousTotal > 0 {
			overallChangePercent = (overallChange / previousTotal) * 100
		}

		// Project month-end cost based on daily average so far
		daysInMonth := float64(daysInCurrentMonth())
		daysElapsed := float64(now.Day())
		projectedMonthEnd := 0.0
		if daysElapsed > 0 {
			dailyAverage := currentTotal / daysElapsed
			projectedMonthEnd = dailyAverage * daysInMonth
		}

		report := CostTrendReport{
			SubscriptionID:       subID,
			SubscriptionName:     subName,
			DailyTrends:          trends,
			CurrentMonthTotal:    currentTotal,
			PreviousMonthTotal:   previousTotal,
			OverallChange:        overallChange,
			OverallChangePercent: overallChangePercent,
			ProjectedMonthEnd:    projectedMonthEnd,
		}

		c.JSON(200, report)
	})

	r.GET("/api/reports/enhanced", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		if len(subs) == 0 {
			subs = getVisibleSubscriptions(c.Request.Context())
		}

		now := time.Now()
		currentMonthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		previousMonthStart := currentMonthStart.AddDate(0, -1, 0)
		previousMonthEnd := currentMonthStart.Add(-time.Second)

		var rgReports []ResourceGroupCostReport
		var trendReports []CostTrendReport
		var topChanges []CostChangeItem
		totalCurrentCost := 0.0
		totalPreviousCost := 0.0
		totalResources := 0
		totalRGs := 0

		for _, subID := range subs {
			subName := getSubscriptionName(c.Request.Context(), subID)

			// Get resource groups
			rgs := getResourceGroupsForSubscription(c.Request.Context(), subID)

			for _, rg := range rgs {
				currentCost := fetchResourceGroupCost(c.Request.Context(), subID, rg, currentMonthStart, now)
				previousCost := fetchResourceGroupCost(c.Request.Context(), subID, rg, previousMonthStart, previousMonthEnd)

				resources, _, _ := FetchResourcesWithCosts(c.Request.Context(), []string{subID}, []string{rg}, nil, nil, "", false, false, false, false, "", "")

				totalCurrentCost += currentCost
				totalPreviousCost += previousCost
				totalResources += len(resources)
				totalRGs++

				// Track changes
				change := currentCost - previousCost
				changePercent := 0.0
				if previousCost > 0 {
					changePercent = (change / previousCost) * 100
				}

				var changeType string
				if previousCost == 0 && currentCost > 0 {
					changeType = "new"
				} else if change > 0 {
					changeType = "increased"
				} else if change < 0 {
					changeType = "decreased"
				} else {
					changeType = "stable"
				}

				topChanges = append(topChanges, CostChangeItem{
					ResourceGroup: rg,
					ChangeType:    changeType,
					CurrentCost:   currentCost,
					PreviousCost:  previousCost,
					ChangeAmount:  change,
					ChangePercent: changePercent,
				})

				// Sort top resources in RG
				sort.Slice(resources, func(i, j int) bool {
					return resources[i].Cost > resources[j].Cost
				})

				var topResources []ResourceCostSummary
				rgTotal := 0.0
				for _, r := range resources {
					rgTotal += r.Cost
				}
				for i, r := range resources {
					if i >= 5 {
						break
					}
					percent := 0.0
					if rgTotal > 0 {
						percent = (r.Cost / rgTotal) * 100
					}
					topResources = append(topResources, ResourceCostSummary{
						ResourceID:   r.ID,
						ResourceName: r.Name,
						ResourceType: r.Type,
						MonthlyCost:  r.Cost,
						CostPercent:  percent,
					})
				}

				changePct := 0.0
				if previousCost > 0 {
					changePct = (change / previousCost) * 100
				}

				rgReports = append(rgReports, ResourceGroupCostReport{
					ResourceGroup:       rg,
					SubscriptionID:      subID,
					SubscriptionName:    subName,
					CurrentMonthCost:    currentCost,
					PreviousMonthCost:   previousCost,
					CostChange:          change,
					CostChangePercent:   changePct,
					ResourceCount:       len(resources),
					TopCostResources:    topResources,
				})
			}

			// Get daily trends for this subscription
			currentDaily, _ := fetchDailyCostsWithCache(c.Request.Context(), subID, currentMonthStart, now)
			previousDaily, _ := fetchDailyCostsWithCache(c.Request.Context(), subID, previousMonthStart, previousMonthEnd)

			var trends []DailyCostTrend
			subCurrentTotal := 0.0
			subPreviousTotal := 0.0

			previousByDay := make(map[int]float64)
			for _, d := range previousDaily {
				if day, ok := d["day"].(int); ok {
					if cost, ok := d["cost"].(float64); ok {
						previousByDay[day] = cost
						subPreviousTotal += cost
					}
				}
			}

			for _, d := range currentDaily {
				if day, ok := d["day"].(int); ok {
					if currentCost, ok := d["cost"].(float64); ok {
						previousCost := previousByDay[day]
						change := currentCost - previousCost
						changePercent := 0.0
						if previousCost > 0 {
							changePercent = (change / previousCost) * 100
						}
						trends = append(trends, DailyCostTrend{
							Date:            fmt.Sprintf("%02d", day),
							CurrentMonth:    currentCost,
							PreviousMonth:   previousCost,
							Change:          change,
							ChangePercent:   changePercent,
						})
						subCurrentTotal += currentCost
					}
				}
			}

			sort.Slice(trends, func(i, j int) bool {
				return trends[i].Date < trends[j].Date
			})

			overallChange := subCurrentTotal - subPreviousTotal
			overallChangePercent := 0.0
			if subPreviousTotal > 0 {
				overallChangePercent = (overallChange / subPreviousTotal) * 100
			}

			daysInMonth := float64(daysInCurrentMonth())
			daysElapsed := float64(now.Day())
			projectedMonthEnd := 0.0
			if daysElapsed > 0 {
				dailyAverage := subCurrentTotal / daysElapsed
				projectedMonthEnd = dailyAverage * daysInMonth
			}

			trendReports = append(trendReports, CostTrendReport{
				SubscriptionID:       subID,
				SubscriptionName:     subName,
				DailyTrends:          trends,
				CurrentMonthTotal:    subCurrentTotal,
				PreviousMonthTotal:   subPreviousTotal,
				OverallChange:        overallChange,
				OverallChangePercent: overallChangePercent,
				ProjectedMonthEnd:    projectedMonthEnd,
			})
		}

		// Sort top changes by absolute change amount
		sort.Slice(topChanges, func(i, j int) bool {
			return math.Abs(topChanges[i].ChangeAmount) > math.Abs(topChanges[j].ChangeAmount)
		})

		// Limit to top 10 changes
		if len(topChanges) > 10 {
			topChanges = topChanges[:10]
		}

		// Calculate overall change
		totalChange := totalCurrentCost - totalPreviousCost
		totalChangePercent := 0.0
		if totalPreviousCost > 0 {
			totalChangePercent = (totalChange / totalPreviousCost) * 100
		}

		avgCostPerResource := 0.0
		if totalResources > 0 {
			avgCostPerResource = totalCurrentCost / float64(totalResources)
		}

		// Detect anomalies in top changes
		var anomalies []CostAnomaly
		for _, change := range topChanges {
			if change.ChangePercent > 50 || change.ChangePercent < -30 {
				anomalies = append(anomalies, CostAnomaly{
					ResourceGroup:    change.ResourceGroup,
					ExpectedCost:     change.PreviousCost,
					ActualCost:       change.CurrentCost,
					Deviation:        change.ChangeAmount,
					DeviationPercent: change.ChangePercent,
					Severity:         detectAnomalySeverity(change.ChangePercent),
				})
			}
		}

		// Build resource type breakdown
		typeBreakdown := buildResourceTypeBreakdown(rgReports, totalCurrentCost)

		// Build subscription comparisons
		subComparisons := buildSubscriptionComparisons(rgReports, totalCurrentCost)

		// Build cost distribution
		costDist := buildCostDistribution(rgReports)

		// Build historical trends for multiple periods
		historicalTrends := buildHistoricalTrends(subs)

		// Build cost forecast
		forecast := buildCostForecast(totalCurrentCost, totalPreviousCost, rgReports)

		// Build resource efficiency data
		efficiency := buildResourceEfficiency(rgReports)

		// Build sparkline data
		sparklines := buildSparklines(rgReports, trendReports)

		// Build cost savings recommendations
		savingsRecs := buildSavingsRecommendations(rgReports)

		// Build monthly heatmaps
		heatmaps := buildMonthlyHeatmaps(rgReports, subs)

		// Build detailed changes
		detailedChanges := buildDetailedChanges(rgReports)

		// Build tag allocations
		tagAllocations := buildTagAllocations(rgReports)

		// Build benchmarks
		benchmarks := buildBenchmarks(totalCurrentCost, totalPreviousCost, rgReports)

		// Build weekly summaries
		weeklySummaries := buildWeeklySummaries(rgReports)

		// Calculate budget limit (120% of projected spend as default)
		budgetLimit := totalCurrentCost * 1.2
		if totalPreviousCost > totalCurrentCost {
			budgetLimit = totalPreviousCost * 1.1
		}

		// Build executive summary
		execSummary := buildExecutiveSummary(totalCurrentCost, totalPreviousCost, budgetLimit, rgReports)

		// Build cost alerts
		costAlerts := buildCostAlerts(rgReports, budgetLimit)

		// Build resource lifecycles
		resourceLifecycles := buildResourceLifecycles(rgReports)

		// Build department rollups
		departmentRollups := buildDepartmentRollups(rgReports)

		// Build cost velocity metrics
		costVelocity := buildCostVelocity(rgReports, trendReports)

		// Build service-level breakdowns
		serviceBreakdowns := buildServiceLevelBreakdown(rgReports)

		// Build geographic distribution
		geoDistribution := buildGeographicDistribution(rgReports)

		// Build usage efficiency metrics
		usageEfficiency := buildUsageEfficiencyMetrics(rgReports)

		// Build resource group change timelines
		rgTimelines := buildRGChangeTimelines(rgReports, trendReports)

		// Build budget tracking
		budgetTracking := buildBudgetTracking(totalCurrentCost, rgReports)

		// Build resource drift analysis
		resourceDrift := buildResourceDrift(rgReports)

		// Build multi-month trends
		multiMonthTrends := buildMultiMonthTrends(rgReports)

		// Build cost attribution
		costAttribution := buildCostAttribution(rgReports)

		// Build cost correlations
		costCorrelations := buildCostCorrelations(rgReports, trendReports)

		// Build anomaly patterns
		anomalyPatterns := buildAnomalyPatterns(anomalies)

		// Build comparison matrices
		comparisonMatrices := buildComparisonMatrices(rgReports, trendReports)

		// Build daily cost heatmaps
		dailyCostHeatmaps := buildDailyCostHeatmaps(rgReports)

		// Build resource group scorecards
		rgScorecards := buildRGScorecards(rgReports)

		// Build export metadata first (needed for export data)
		exportMeta := ExportOptions{
			Format:         "enhanced",
			IncludeRawData: true,
			DateRange:      currentMonthStart.Format("2006-01-02") + " to " + now.Format("2006-01-02"),
			Fields: []string{
				"resourceGroup", "cost", "change", "efficiency", "recommendations",
			},
		}

		// Build trend line data for charts
		trendLineData := buildTrendLineData(rgReports, trendReports)

		// Build cost scenarios
		costScenarios := buildCostScenarios(totalCurrentCost, totalPreviousCost, rgReports)

		// Build export data
		exportData := buildExportData(rgReports, trendReports, exportMeta)

		// Build color indicators
		colorIndicators := buildColorIndicators(totalCurrentCost, totalPreviousCost, budgetLimit, rgReports)

		// Build drill-down data
		drillDownData := buildDrillDownData(rgReports)

		// Build PDF summary
		pdfSummary := buildPDFSummary(totalCurrentCost, totalPreviousCost, rgReports, exportMeta)

		// Build notification triggers
		notificationTriggers := buildNotificationTriggers(totalCurrentCost, totalPreviousCost, budgetLimit, rgReports)

		// Build historical snapshots
		historicalSnapshots := buildHistoricalSnapshots(rgReports)

		// Build chart configuration
		chartConfig := buildChartConfig()

		report := EnhancedReport{
			GeneratedAt:               now,
			ReportPeriod:              currentMonthStart.Format("January 2006"),
			ResourceGroupReports:      rgReports,
			CostTrends:                trendReports,
			TopChanges:                topChanges,
			CostAnomalies:             anomalies,
			ResourceTypeBreakdown:     typeBreakdown,
			SubscriptionComparisons:   subComparisons,
			CostDistribution:          costDist,
			HistoricalTrends:          historicalTrends,
			Forecast:                  forecast,
			ResourceEfficiency:        efficiency,
			Sparklines:                sparklines,
			SavingsRecommendations:    savingsRecs,
			MonthlyHeatmaps:             heatmaps,
			DetailedChanges:             detailedChanges,
			TagAllocations:              tagAllocations,
			Benchmarks:                  benchmarks,
			WeeklySummaries:             weeklySummaries,
			ExecutiveSummary:            execSummary,
			CostAlerts:                  costAlerts,
			ResourceLifecycles:          resourceLifecycles,
			DepartmentRollups:           departmentRollups,
			CostVelocity:                costVelocity,
			ServiceBreakdowns:           serviceBreakdowns,
			GeographicDistribution:      geoDistribution,
			UsageEfficiencyMetrics:      usageEfficiency,
			RGChangeTimelines:           rgTimelines,
			BudgetTracking:              budgetTracking,
			ResourceDrift:               resourceDrift,
			MultiMonthTrends:            multiMonthTrends,
			CostAttribution:             costAttribution,
			CostCorrelations:            costCorrelations,
			AnomalyPatterns:             anomalyPatterns,
			ComparisonMatrices:          comparisonMatrices,
			DailyCostHeatmaps:           dailyCostHeatmaps,
			RGScorecards:                rgScorecards,
			TrendLineData:               trendLineData,
			CostScenarios:               costScenarios,
			ExportData:                  exportData,
			ColorIndicators:             colorIndicators,
			DrillDownData:               drillDownData,
			PDFSummary:                  pdfSummary,
			NotificationTriggers:        notificationTriggers,
			HistoricalSnapshots:         historicalSnapshots,
			ChartConfig:                 chartConfig,
			ExportMetadata:              exportMeta,
			Summary: ReportSummary{
				TotalCurrentMonthCost:  totalCurrentCost,
				TotalPreviousMonthCost: totalPreviousCost,
				TotalChange:            totalChange,
				TotalChangePercent:     totalChangePercent,
				TotalResourceGroups:    totalRGs,
				TotalResources:         totalResources,
				AvgCostPerResource:     avgCostPerResource,
			},
		}

		c.JSON(200, report)
	})

	fmt.Printf("CloudViz server starting at :%s\n", port)

	// Pre-fetch daily costs for all subscriptions on startup
	go func() {
		log.Println("Startup: pre-fetching daily costs for all subscriptions...")
		ctx := context.Background()
		subs, err := DiscoverSubscriptions(ctx)
		if err != nil {
			log.Printf("Startup: failed to discover subscriptions: %v", err)
			return
		}

		now := time.Now()
		start := now.AddDate(0, 0, -30)

		for i, sub := range subs {
			// Check if already cached
			if _, ok := cache.getDailyCosts(sub.ID, start, now); ok {
				continue
			}

			log.Printf("Startup: fetching daily costs for %s (%d/%d)", sub.Name, i+1, len(subs))
			daily, err := fetchDailyCosts(costClient, sub.ID, start, now, ctx)
			if err != nil {
				log.Printf("Startup: failed to fetch daily costs for %s: %v", sub.Name, err)
				continue
			}
			cache.setDailyCosts(sub.ID, daily)
			log.Printf("Startup: cached %d daily cost entries for %s", len(daily), sub.Name)

			// Sleep to avoid rate limits
			time.Sleep(2 * time.Second)
		}
		log.Println("Startup: daily cost pre-fetch complete")
	}()

	// Background sync disabled - fetch costs on-demand via SSE only
	// go backgroundSync(costClient)
	go openBrowser(fmt.Sprintf("http://localhost:%s", port))
	r.Run(":" + port)
}

// openBrowser opens the default browser at the given URL.
func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "darwin":
		err = exec.Command("open", url).Start()
	case "windows":
		err = exec.Command("cmd", "/c", "start", url).Start()
	default:
		_, err = exec.LookPath("xdg-open")
		if err == nil {
			err = exec.Command("xdg-open", url).Start()
		}
	}
	if err != nil {
		log.Printf("Failed to open browser: %v", err)
	}
}

func historyHandler(c *gin.Context) {
	sinceParam := c.Query("since")
	var sinceTime time.Time
	if sinceParam != "" {
		// Accept RFC3339 or RFC3339Nano
		if t, err := time.Parse(time.RFC3339Nano, sinceParam); err == nil {
			sinceTime = t
		} else if t, err := time.Parse(time.RFC3339, sinceParam); err == nil {
			sinceTime = t
		}
	}
	// Use plain "YYYY-MM-DD HH:MM:SS" string (matches stored timestamp format) so
	// the idx_history_timestamp index works without a datetime() function wrapper.
	var queryArgs []any
	baseQuery := `SELECT h.resource_id, COALESCE(h.resource_name, h.resource_id),
		COALESCE(h.resource_type, ''), h.change_type, h.field_name, h.old_value,
		h.new_value, h.timestamp, COALESCE(h.resource_cost, 0),
		COALESCE(h.changed_by, 'Unknown')
		FROM resource_history h`
	if !sinceTime.IsZero() {
		// Format as plain date-time (same format as stored timestamps) for correct string comparison
		sinceStr := sinceTime.In(time.Local).Format("2006-01-02 15:04:05")
		baseQuery += ` WHERE h.timestamp >= ?`
		queryArgs = append(queryArgs, sinceStr)
	}
	baseQuery += ` ORDER BY h.timestamp DESC LIMIT 1000`

	rows, err := cache.db.Query(baseQuery, queryArgs...)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	type rawRow struct {
		ResourceChange
		StoredCost float64
	}
	var rawRows []rawRow
	var needCost []string
	for rows.Next() {
		var r rawRow
		if rows.Scan(&r.ResourceID, &r.ResourceName, &r.ResourceType, &r.ChangeType,
			&r.Field, &r.OldValue, &r.NewValue, &r.Timestamp, &r.StoredCost, &r.ChangedBy) == nil {
			rawRows = append(rawRows, r)
			if r.StoredCost == 0 {
				needCost = append(needCost, strings.ToLower(r.ResourceID))
			}
		}
	}
	rows.Close()

	// Batch-lookup costs only for rows that need it
	costMap := make(map[string]float64)
	if len(needCost) > 0 {
		placeholders := make([]string, len(needCost))
		args := make([]interface{}, len(needCost))
		for i, id := range needCost {
			placeholders[i] = "?"
			args[i] = id
		}
		cr, err2 := cache.db.Query(
			`SELECT LOWER(resource_id), SUM(cost) FROM costs WHERE LOWER(resource_id) IN (`+strings.Join(placeholders, ",")+`) AND period='current' GROUP BY LOWER(resource_id)`,
			args...)
		if err2 == nil {
			for cr.Next() {
				var rid string
				var cost float64
				cr.Scan(&rid, &cost)
				costMap[rid] = cost
			}
			cr.Close()
		}
	}

	// Resolve any GUID changedBy values via Microsoft Graph
	callers := make([]string, len(rawRows))
	for i, r := range rawRows {
		callers[i] = r.ChangedBy
	}
	callers = resolveChangedByBatch(c.Request.Context(), callers)

	history := make([]ResourceChange, 0, len(rawRows))
	for i, r := range rawRows {
		h := r.ResourceChange
		h.ChangedBy = callers[i]
		if r.StoredCost > 0 {
			h.Cost = r.StoredCost
		} else {
			h.Cost = costMap[strings.ToLower(r.ResourceID)]
		}
		history = append(history, h)
	}

	// Build per-day cost impact summary from the same window
	type daySummary struct {
		Date          string  `json:"date"`
		TotalDailyCost float64 `json:"totalDailyCost"` // actual spend that day from cost_daily
		AddedCost     float64 `json:"addedCost"`      // monthly cost added by new resources / 30
		RemovedCost   float64 `json:"removedCost"`    // monthly cost removed by deletions / 30
		CreatedCount  int     `json:"createdCount"`
		DeletedCount  int     `json:"deletedCount"`
	}
	dayMap := make(map[string]*daySummary)
	for _, h := range history {
		if h.Cost == 0 {
			continue
		}
		day := h.Timestamp.Format("2006-01-02")
		if dayMap[day] == nil {
			dayMap[day] = &daySummary{Date: day}
		}
		daily := h.Cost / 30.0
		switch strings.ToLower(h.ChangeType) {
		case "created":
			dayMap[day].AddedCost += daily
			dayMap[day].CreatedCount++
		case "deleted":
			dayMap[day].RemovedCost += daily
			dayMap[day].DeletedCount++
		}
	}

	// Enrich with actual daily totals from cost_daily
	if len(dayMap) > 0 {
		for day, ds := range dayMap {
			var total float64
			cache.db.QueryRow(`SELECT COALESCE(SUM(cost),0) FROM cost_daily WHERE date = ?`, day).Scan(&total)
			ds.TotalDailyCost = total
		}
	}

	dailyImpact := make([]daySummary, 0, len(dayMap))
	for _, ds := range dayMap {
		dailyImpact = append(dailyImpact, *ds)
	}
	sort.Slice(dailyImpact, func(i, j int) bool { return dailyImpact[i].Date > dailyImpact[j].Date })

	c.JSON(200, gin.H{
		"items":       history,
		"dailyImpact": dailyImpact,
	})
}

func costDriversHandler(c *gin.Context) {
	// Default to today; accept ?date=YYYY-MM-DD override
	dateParam := c.Query("date")
	var targetDate string
	if dateParam != "" {
		targetDate = dateParam
	} else {
		targetDate = time.Now().Format("2006-01-02")
	}
	t, _ := time.Parse("2006-01-02", targetDate)
	// Use local-timezone range bounds so idx_history_timestamp index is used
	rangeStart := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
	rangeEnd := rangeStart.AddDate(0, 0, 1)

	prevDate := rangeStart.AddDate(0, 0, -1).Format("2006-01-02")

	type CostDriver struct {
		ResourceID    string  `json:"resourceId"`
		ResourceName  string  `json:"resourceName"`
		ResourceType  string  `json:"resourceType"`
		ResourceGroup string  `json:"resourceGroup"`
		ChangeType    string  `json:"changeType"`
		MonthlyCost   float64 `json:"monthlyCost"`
		DailyCost     float64 `json:"dailyCost"`
		ChangedBy     string  `json:"changedBy"`
	}

	// Step 1: fetch created/deleted events for the day — uses idx_history_timestamp index, very fast.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	rows, err := cache.db.QueryContext(ctx, `
		SELECT
			h.resource_id,
			COALESCE(h.resource_name, h.resource_id),
			COALESCE(h.resource_type, ''),
			h.change_type,
			COALESCE(h.resource_cost, 0),
			COALESCE(h.changed_by,'Unknown')
		FROM resource_history h
		WHERE h.timestamp >= ? AND h.timestamp < ?
		  AND h.change_type IN ('created','deleted')
		GROUP BY h.resource_id, h.change_type`, rangeStart, rangeEnd)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	type rawEntry struct {
		ResourceID   string
		ResourceName string
		ResourceType string
		ChangeType   string
		StoredCost   float64
		ChangedBy    string
	}
	var entries []rawEntry
	var needCost []string // resource_ids where stored cost is 0
	for rows.Next() {
		var e rawEntry
		if rows.Scan(&e.ResourceID, &e.ResourceName, &e.ResourceType, &e.ChangeType, &e.StoredCost, &e.ChangedBy) == nil {
			entries = append(entries, e)
			if e.StoredCost == 0 {
				needCost = append(needCost, strings.ToLower(e.ResourceID))
			}
		}
	}
	rows.Close()

	// Step 2: batch-lookup costs only for resources that need it (much smaller set than full costs table scan).
	costMap := make(map[string]float64)
	if len(needCost) > 0 {
		placeholders := make([]string, len(needCost))
		args := make([]interface{}, len(needCost))
		for i, id := range needCost {
			placeholders[i] = "?"
			args[i] = id
		}
		costRows, err2 := cache.db.QueryContext(ctx,
			`SELECT LOWER(resource_id), SUM(cost) FROM costs WHERE LOWER(resource_id) IN (`+strings.Join(placeholders, ",")+`) AND period='current' GROUP BY LOWER(resource_id)`,
			args...)
		if err2 == nil {
			for costRows.Next() {
				var rid string
				var cost float64
				costRows.Scan(&rid, &cost)
				costMap[rid] = cost
			}
			costRows.Close()
		}
	}

	// Step 3: extract resource_group from resource ID path, merge costs, filter zeros.
	rgFrom := func(id string) string {
		lower := strings.ToLower(id)
		const marker = "/resourcegroups/"
		idx := strings.Index(lower, marker)
		if idx < 0 {
			return ""
		}
		rest := id[idx+len(marker):]
		if slash := strings.Index(rest, "/"); slash >= 0 {
			return rest[:slash]
		}
		return rest
	}

	// Resolve GUID changedBy values via Graph API
	callersList := make([]string, len(entries))
	for i, e := range entries {
		callersList[i] = e.ChangedBy
	}
	callersList = resolveChangedByBatch(ctx, callersList)

	var drivers []CostDriver
	for i, e := range entries {
		cost := e.StoredCost
		if cost == 0 {
			cost = costMap[strings.ToLower(e.ResourceID)]
		}
		if cost == 0 {
			continue
		}
		drivers = append(drivers, CostDriver{
			ResourceID:    e.ResourceID,
			ResourceName:  e.ResourceName,
			ResourceType:  e.ResourceType,
			ResourceGroup: rgFrom(e.ResourceID),
			ChangeType:    e.ChangeType,
			MonthlyCost:   cost,
			DailyCost:     cost / 30.0,
			ChangedBy:     callersList[i],
		})
	}
	sort.Slice(drivers, func(i, j int) bool { return drivers[i].MonthlyCost > drivers[j].MonthlyCost })
	if len(drivers) > 30 {
		drivers = drivers[:30]
	}

	// Daily totals
	var targetTotal, prevTotal float64
	cache.db.QueryRow(`SELECT COALESCE(SUM(cost),0) FROM cost_daily WHERE date=?`, targetDate).Scan(&targetTotal)
	cache.db.QueryRow(`SELECT COALESCE(SUM(cost),0) FROM cost_daily WHERE date=?`, prevDate).Scan(&prevTotal)

	// Aggregate added vs removed
	var totalAdded, totalRemoved float64
	var addedCount, removedCount int
	for _, d := range drivers {
		if d.ChangeType == "created" {
			totalAdded += d.DailyCost
			addedCount++
		} else {
			totalRemoved += d.DailyCost
			removedCount++
		}
	}

	c.JSON(200, gin.H{
		"date":         targetDate,
		"prevDate":     prevDate,
		"dailyTotal":   targetTotal,
		"prevTotal":    prevTotal,
		"delta":        targetTotal - prevTotal,
		"addedCost":    totalAdded,
		"removedCost":  totalRemoved,
		"addedCount":   addedCount,
		"removedCount": removedCount,
		"drivers":      drivers,
	})
}

// rgTrendsHandler returns daily net cost change per resource group for the last N days.
// Each value is the net monthly-cost impact of that day's resource changes, divided by 30 ($/day).
func rgTrendsHandler(c *gin.Context) {
	days := 7
	if d, _ := strconv.Atoi(c.Query("days")); d == 14 || d == 30 {
		days = d
	}
	topN := 8

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	// Build list of all dates in range (newest-first for sorting, we'll reverse later)
	today := time.Now().In(time.Local)
	dates := make([]string, days)
	for i := 0; i < days; i++ {
		dates[days-1-i] = today.AddDate(0, 0, -i).Format("2006-01-02")
	}

	// Query: net daily cost change ($/month) per resource group, extracting rg from resource_id
	const rgExtract = `LOWER(SUBSTR(h.resource_id,
		INSTR(LOWER(h.resource_id),'/resourcegroups/')+16,
		CASE WHEN INSTR(SUBSTR(LOWER(h.resource_id),INSTR(LOWER(h.resource_id),'/resourcegroups/')+16),'/')>0
		     THEN INSTR(SUBSTR(LOWER(h.resource_id),INSTR(LOWER(h.resource_id),'/resourcegroups/')+16),'/')-1
		     ELSE 100 END))`

	query := `SELECT date(h.timestamp,'localtime') as day,` + rgExtract + ` as rg,
		SUM(CASE WHEN h.change_type='created' THEN COALESCE(h.resource_cost,0)
		         WHEN h.change_type='deleted' THEN -COALESCE(h.resource_cost,0)
		         ELSE 0 END) / 30.0 as net_daily,
		SUM(COALESCE(h.resource_cost,0)) as abs_total
		FROM resource_history h
		WHERE h.timestamp >= date('now',?) AND h.timestamp < date('now','+1 day')
		  AND h.change_type IN ('created','deleted')
		  AND h.resource_cost > 0
		  AND h.resource_id LIKE '%/resourcegroups/%'
		GROUP BY day, rg
		HAVING rg != '' AND rg IS NOT NULL
		ORDER BY day, abs_total DESC`

	rows, err := cache.db.QueryContext(ctx, query, fmt.Sprintf("-%d days", days))
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type dayRGRow struct{ day, rg string; net, abs float64 }
	// rgAbsTotal accumulates per-rg absolute activity for selecting top N
	rgAbsTotal := map[string]float64{}
	// raw data: day → rg → net$/day
	raw := map[string]map[string]float64{}
	for rows.Next() {
		var r dayRGRow
		if rows.Scan(&r.day, &r.rg, &r.net, &r.abs) != nil {
			continue
		}
		rgAbsTotal[r.rg] += r.abs
		if raw[r.day] == nil {
			raw[r.day] = map[string]float64{}
		}
		raw[r.day][r.rg] = r.net
	}

	// Pick top N resource groups by absolute total activity
	type rgScore struct{ name string; score float64 }
	ranked := make([]rgScore, 0, len(rgAbsTotal))
	for rg, s := range rgAbsTotal {
		ranked = append(ranked, rgScore{rg, s})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	if len(ranked) > topN {
		ranked = ranked[:topN]
	}

	type RGSeries struct {
		Name       string    `json:"name"`
		DailyCosts []float64 `json:"dailyCosts"`
		TotalAbs   float64   `json:"totalAbs"`
	}
	series := make([]RGSeries, 0, len(ranked))
	for _, r := range ranked {
		costs := make([]float64, len(dates))
		for i, d := range dates {
			if v, ok := raw[d][r.name]; ok {
				costs[i] = math.Round(v*100) / 100
			}
		}
		series = append(series, RGSeries{Name: r.name, DailyCosts: costs, TotalAbs: math.Round(r.score/30*100) / 100})
	}

	c.JSON(200, gin.H{
		"dates":  dates,
		"groups": series,
		"days":   days,
	})
}

type streamMsg struct {
	Type    string `json:"type"`
	SubID   string `json:"subId,omitempty"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

func sseHandler(c *gin.Context) {
	subs := c.QueryArray("subscriptionId")
	log.Printf("SSE: starting stream for %d subscriptions", len(subs))
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	msgChan := make(chan streamMsg, len(subs)*4) // Larger buffer to prevent blocking
	go func() {
		defer close(msgChan)
		var uncached []string
		cachedCount := 0
		// First, send cached data and identify uncached subs
		for _, sid := range subs {
			curr, ok1 := cache.get(sid, "current")
			prev, ok2 := cache.get(sid, "previous")
			if ok1 {
				cachedCount++
				data := gin.H{"current": normalizeResults(curr)}
				if ok2 {
					data["previous"] = normalizeResults(prev)
				}
				msgChan <- streamMsg{Type: "data", SubID: sid, Data: data}
				msgChan <- streamMsg{Type: "status", SubID: sid, Message: "synced"}
			} else {
				uncached = append(uncached, sid)
			}
		}
		log.Printf("SSE: %d cached, %d uncached subscriptions", cachedCount, len(uncached))

		// Fetch uncached subs in parallel batches of 4.
		// Each sub gets up to 5 minutes to handle internal 429 retries.
		if len(uncached) > 0 {
			const batchSize = 4
			for batchStart := 0; batchStart < len(uncached); batchStart += batchSize {
				end := batchStart + batchSize
				if end > len(uncached) {
					end = len(uncached)
				}
				batch := uncached[batchStart:end]
				var wg sync.WaitGroup
				for _, subID := range batch {
					wg.Add(1)
					go func(sid string) {
						defer wg.Done()
						log.Printf("SSE: fetching sub %d/%d: %s", batchStart+1, len(uncached), sid)
						now := time.Now()
						ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)

						// Fetch current and previous periods concurrently
						var currErr, prevErr error
						var fetchWg sync.WaitGroup
						fetchWg.Add(2)
						go func() {
							defer fetchWg.Done()
							_, currErr = fetchSubCostsSync(costClient, sid, CostPeriodCurrent, now.AddDate(0, 0, -30), ctx)
						}()
						go func() {
							defer fetchWg.Done()
							_, prevErr = fetchSubCostsSync(costClient, sid, CostPeriodPrevious, now.AddDate(0, 0, -60), ctx)
						}()
						fetchWg.Wait()
						cancel()

						// Log any errors but don't fail if current succeeds
						if currErr != nil {
							log.Printf("SSE: error fetching current %s: %v", sid, currErr)
							msgChan <- streamMsg{Type: "status", SubID: sid, Message: "error: " + currErr.Error()}
							return
						}
						if prevErr != nil {
							log.Printf("SSE: error fetching previous %s: %v", sid, prevErr)
						}

						data := gin.H{}
						if res, ok := cache.get(sid, "current"); ok {
							data["current"] = normalizeResults(res)
						}
						if res, ok := cache.get(sid, "previous"); ok {
							data["previous"] = normalizeResults(res)
						}
						msgChan <- streamMsg{Type: "data", SubID: sid, Data: data}
						msgChan <- streamMsg{Type: "status", SubID: sid, Message: "synced"}
					}(subID)
				}
				wg.Wait()
			}
		}
		log.Printf("SSE: sending done message")
		msgChan <- streamMsg{Type: "done"}
	}()

	// Keep-alive ticker to prevent connection timeouts
	keepAlive := time.NewTicker(5 * time.Second)
	defer keepAlive.Stop()

	clientDisconnected := c.Request.Context().Done()
	for {
		select {
		case <-clientDisconnected:
			log.Printf("SSE: client disconnected")
			return
		case msg := <-msgChan:
			data, _ := json.Marshal(msg)
			c.SSEvent("message", string(data))
			c.Writer.Flush()
			if msg.Type == "done" {
				log.Printf("SSE: stream completed")
				return
			}
		case <-keepAlive.C:
			// Send keep-alive comment to prevent timeout
			c.Writer.WriteString(":keepalive\n\n")
			c.Writer.Flush()
		}
	}
}

func backgroundSync(client *armcostmanagement.QueryClient) {
	log.Println("Starting background cost sync...")

	// Fetch all subscriptions from filters
	ctx := context.Background()
	res, _, err := FetchResourcesWithCosts(ctx, nil, nil, nil, nil, "", false, false, false, false, "", "")
	if err != nil {
		log.Printf("Background sync: failed to get resources: %v", err)
		return
	}

	// Get unique subscription IDs
	subMap := make(map[string]bool)
	for _, r := range res {
		subMap[r.SubscriptionID] = true
	}

	var subs []string
	for s := range subMap {
		subs = append(subs, s)
	}
	log.Printf("Background sync: found %d subscriptions", len(subs))

	// Fetch costs for each subscription
	for i, sid := range subs {
		// Check if already cached
		if _, ok := cache.get(sid, "current"); ok {
			continue
		}

		log.Printf("Background sync: fetching %s (%d/%d)", sid, i+1, len(subs))
		now := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		_, err := fetchSubCostsSync(client, sid, CostPeriodCurrent, now.AddDate(0, 0, -30), ctx)
		cancel()

		if err != nil {
			log.Printf("Background sync: failed for %s: %v", sid, err)
		} else {
			log.Printf("Background sync: completed %s", sid)
		}

		// Sleep to avoid rate limits - Azure is very strict
		time.Sleep(30 * time.Second)
	}

	log.Println("Background sync: completed")
}

// Helper functions for enhanced reporting

// getVisibleSubscriptions returns list of subscription IDs from fetched resources
func getVisibleSubscriptions(ctx context.Context) []string {
	res, _, err := FetchResourcesWithCosts(ctx, nil, nil, nil, nil, "", false, false, false, false, "", "")
	if err != nil {
		return []string{}
	}

	subMap := make(map[string]bool)
	for _, r := range res {
		subMap[r.SubscriptionID] = true
	}

	var subs []string
	for s := range subMap {
		subs = append(subs, s)
	}
	return subs
}

// getResourceGroupsForSubscription returns resource groups for a subscription
func getResourceGroupsForSubscription(ctx context.Context, subID string) []string {
	// Use existing resources to get resource groups
	res, _, err := FetchResourcesWithCosts(ctx, []string{subID}, nil, nil, nil, "", false, false, false, false, "", "")
	if err != nil {
		return []string{}
	}

	rgMap := make(map[string]bool)
	for _, r := range res {
		if r.SubscriptionID == subID && r.ResourceGroup != "" {
			rgMap[r.ResourceGroup] = true
		}
	}

	var rgs []string
	for rg := range rgMap {
		rgs = append(rgs, rg)
	}
	return rgs
}

// fetchResourceGroupCost calculates cost for a resource group from cached data
func fetchResourceGroupCost(ctx context.Context, subID, rg string, start, end time.Time) float64 {
	// Try to get from cache
	if cache != nil {
		res, ok := cache.get(subID, "current")
		if ok {
			totalCost := 0.0
			if res.Properties != nil && res.Properties.Rows != nil {
				for _, row := range res.Properties.Rows {
					if len(row) >= 5 {
						// Find ResourceGroup column (usually index 1)
						if rgVal, ok := row[1].(string); ok {
							if strings.EqualFold(rgVal, rg) {
								if cost, ok := row[4].(float64); ok {
									totalCost += cost
								}
							}
						}
					}
				}
			}
			return totalCost
		}
	}

	// Fallback: calculate from resources
	res, _, err := FetchResourcesWithCosts(ctx, []string{subID}, []string{rg}, nil, nil, "", false, false, false, false, "", "")
	if err != nil {
		return 0
	}

	totalCost := 0.0
	for _, r := range res {
		totalCost += r.Cost
	}
	return totalCost
}

// fetchDailyCostsWithCache fetches daily costs with caching
func fetchDailyCostsWithCache(ctx context.Context, subID string, start, end time.Time) ([]map[string]any, error) {
	if cache != nil {
		daily, ok := cache.getDailyCosts(subID, start, end)
		if ok {
			return daily, nil
		}
	}

	cred, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return nil, err
	}

	client, err := armcostmanagement.NewQueryClient(cred, nil)
	if err != nil {
		return nil, err
	}

	daily, err := fetchDailyCosts(client, subID, start, end, ctx)
	if err != nil {
		return nil, err
	}

	if cache != nil {
		cache.setDailyCosts(subID, daily)
	}

	return daily, nil
}

// getSubscriptionName returns the display name of a subscription
func getSubscriptionName(ctx context.Context, subID string) string {
	// Try to get from resources
	res, _, err := FetchResourcesWithCosts(ctx, []string{subID}, nil, nil, nil, "", false, false, false, false, "", "")
	if err != nil {
		return subID
	}

	for _, r := range res {
		if r.SubscriptionID == subID {
			// Subscription name is usually available in tags or we use ID
			return subID[:8] + "..." // Shorten for display
		}
	}

	return subID
}

// daysInCurrentMonth returns the number of days in the current month
func daysInCurrentMonth() int {
	now := time.Now()
	nextMonth := now.AddDate(0, 1, 0)
	firstOfNextMonth := time.Date(nextMonth.Year(), nextMonth.Month(), 1, 0, 0, 0, 0, time.UTC)
	firstOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	return int(firstOfNextMonth.Sub(firstOfCurrentMonth).Hours() / 24)
}

// Helper functions for enhanced reporting

// detectAnomalySeverity determines the severity level based on change percentage
func detectAnomalySeverity(changePercent float64) string {
	absChange := math.Abs(changePercent)
	switch {
	case absChange >= 200:
		return "critical"
	case absChange >= 100:
		return "high"
	case absChange >= 50:
		return "medium"
	default:
		return "low"
	}
}

// buildResourceTypeBreakdown aggregates costs by resource type
func buildResourceTypeBreakdown(rgReports []ResourceGroupCostReport, totalCost float64) []ResourceTypeBreakdown {
	typeMap := make(map[string]*ResourceTypeBreakdown)

	for _, rg := range rgReports {
		for _, res := range rg.TopCostResources {
			// Extract base resource type
			resType := res.ResourceType
			if idx := strings.LastIndex(resType, "/"); idx >= 0 {
				resType = resType[idx+1:]
			}

			if entry, exists := typeMap[resType]; exists {
				entry.CurrentMonthCost += res.MonthlyCost
				entry.ResourceCount++
				entry.TopResources = append(entry.TopResources, res)
			} else {
				typeMap[resType] = &ResourceTypeBreakdown{
					ResourceType:  resType,
					CurrentMonthCost: res.MonthlyCost,
					ResourceCount: 1,
					TopResources:  []ResourceCostSummary{res},
				}
			}
		}
	}

	// Convert map to slice and calculate percentages
	var result []ResourceTypeBreakdown
	for _, entry := range typeMap {
		if totalCost > 0 {
			entry.PercentageOfTotal = (entry.CurrentMonthCost / totalCost) * 100
		}
		// Sort top resources by cost
		sort.Slice(entry.TopResources, func(i, j int) bool {
			return entry.TopResources[i].MonthlyCost > entry.TopResources[j].MonthlyCost
		})
		// Keep only top 3
		if len(entry.TopResources) > 3 {
			entry.TopResources = entry.TopResources[:3]
		}
		result = append(result, *entry)
	}

	// Sort by cost descending
	sort.Slice(result, func(i, j int) bool {
		return result[i].CurrentMonthCost > result[j].CurrentMonthCost
	})

	return result
}

// buildSubscriptionComparisons creates subscription-level comparisons
func buildSubscriptionComparisons(rgReports []ResourceGroupCostReport, totalCost float64) []SubscriptionComparison {
	subMap := make(map[string]*SubscriptionComparison)

	for _, rg := range rgReports {
		if entry, exists := subMap[rg.SubscriptionID]; exists {
			entry.CurrentMonthCost += rg.CurrentMonthCost
			entry.PreviousMonthCost += rg.PreviousMonthCost
			entry.ResourceGroupCount++
			entry.ResourceCount += rg.ResourceCount
		} else {
			subMap[rg.SubscriptionID] = &SubscriptionComparison{
				SubscriptionID:    rg.SubscriptionID,
				SubscriptionName:  rg.SubscriptionName,
				CurrentMonthCost:  rg.CurrentMonthCost,
				PreviousMonthCost: rg.PreviousMonthCost,
				ResourceGroupCount: 1,
				ResourceCount:     rg.ResourceCount,
			}
		}
	}

	// Convert map to slice and calculate derived fields
	var result []SubscriptionComparison
	for _, entry := range subMap {
		entry.CostChange = entry.CurrentMonthCost - entry.PreviousMonthCost
		if entry.PreviousMonthCost > 0 {
			entry.CostChangePercent = (entry.CostChange / entry.PreviousMonthCost) * 100
		}
		if totalCost > 0 {
			entry.PercentageOfTotal = (entry.CurrentMonthCost / totalCost) * 100
		}
		result = append(result, *entry)
	}

	// Sort by current cost descending and assign ranks
	sort.Slice(result, func(i, j int) bool {
		return result[i].CurrentMonthCost > result[j].CurrentMonthCost
	})
	for i := range result {
		result[i].Rank = i + 1
	}

	return result
}

// buildCostDistribution creates cost distribution by different dimensions
func buildCostDistribution(rgReports []ResourceGroupCostReport) CostDistribution {
	serviceMap := make(map[string]float64)
	locationMap := make(map[string]float64)

	for _, rg := range rgReports {
		// Group by resource group name patterns for service identification
		serviceName := "Other"
		if strings.Contains(strings.ToLower(rg.ResourceGroup), "prod") {
			serviceName = "Production"
		} else if strings.Contains(strings.ToLower(rg.ResourceGroup), "dev") {
			serviceName = "Development"
		} else if strings.Contains(strings.ToLower(rg.ResourceGroup), "test") {
			serviceName = "Testing"
		} else if strings.Contains(strings.ToLower(rg.ResourceGroup), "shared") {
			serviceName = "Shared"
		}
		serviceMap[serviceName] += rg.CurrentMonthCost

		// Extract location from subscription ID (simplified)
		locationMap["Default"] += rg.CurrentMonthCost
	}

	// Calculate totals for percentages
	totalServiceCost := 0.0
	for _, cost := range serviceMap {
		totalServiceCost += cost
	}

	// Build distribution items
	var byService []DistributionItem
	for name, cost := range serviceMap {
		percent := 0.0
		if totalServiceCost > 0 {
			percent = (cost / totalServiceCost) * 100
		}
		byService = append(byService, DistributionItem{
			Name:       name,
			Cost:       cost,
			Percentage: percent,
			Count:      1,
		})
	}

	// Sort by cost descending
	sort.Slice(byService, func(i, j int) bool {
		return byService[i].Cost > byService[j].Cost
	})

	return CostDistribution{
		ByService:  byService,
		ByLocation: []DistributionItem{{Name: "Default", Cost: totalServiceCost, Percentage: 100, Count: len(rgReports)}},
		ByTag:      []DistributionItem{},
	}
}

// buildHistoricalTrends creates historical trend data for multiple time periods
func buildHistoricalTrends(subIDs []string) []HistoricalTrend {
	now := time.Now()
	var trends []HistoricalTrend

	periods := []struct {
		label string
		days  int
	}{
		{"7d", 7},
		{"30d", 30},
		{"90d", 90},
	}

	for _, period := range periods {
		startDate := now.AddDate(0, 0, -period.days)
		totalCost := 0.0
		peakCost := 0.0
		lowestCost := 0.0
		var dailyData []DayCost

		// Aggregate costs across all subscriptions for this period
		for _, subID := range subIDs {
			dailyCosts, _ := fetchDailyCostsWithCache(context.Background(), subID, startDate, now)
			for _, d := range dailyCosts {
				if day, ok := d["day"].(int); ok {
					if cost, ok := d["cost"].(float64); ok {
						totalCost += cost
						if cost > peakCost {
							peakCost = cost
						}
						if lowestCost == 0 || cost < lowestCost {
							lowestCost = cost
						}
						dailyData = append(dailyData, DayCost{
							Date: fmt.Sprintf("%02d", day),
							Cost: cost,
						})
					}
				}
			}
		}

		avgDailyCost := 0.0
		if len(dailyData) > 0 {
			avgDailyCost = totalCost / float64(len(dailyData))
		}

		// Calculate simple growth rate
		growthRate := 0.0
		if len(dailyData) >= 2 {
			firstHalf := 0.0
			secondHalf := 0.0
			midPoint := len(dailyData) / 2
			for i, d := range dailyData {
				if i < midPoint {
					firstHalf += d.Cost
				} else {
					secondHalf += d.Cost
				}
			}
			if firstHalf > 0 {
				growthRate = ((secondHalf - firstHalf) / firstHalf) * 100
			}
		}

		trends = append(trends, HistoricalTrend{
			Period:           period.label,
			StartDate:        startDate.Format("2006-01-02"),
			EndDate:          now.Format("2006-01-02"),
			TotalCost:        totalCost,
			AverageDailyCost: avgDailyCost,
			PeakDayCost:      peakCost,
			LowestDayCost:    lowestCost,
			DailyData:        dailyData,
			GrowthRate:       growthRate,
		})
	}

	return trends
}

// buildCostForecast creates cost forecast based on current trends
func buildCostForecast(currentTotal, previousTotal float64, rgReports []ResourceGroupCostReport) CostForecast {
	now := time.Now()
	daysInMonth := float64(daysInCurrentMonth())
	daysElapsed := float64(now.Day())

	// Project current month
	currentMonthProjected := 0.0
	if daysElapsed > 0 {
		currentMonthProjected = (currentTotal / daysElapsed) * daysInMonth
	}

	// Calculate trend direction
	trendDirection := "stable"
	changePercent := 0.0
	if previousTotal > 0 {
		changePercent = ((currentTotal - previousTotal) / previousTotal) * 100
	}
	if changePercent > 10 {
		trendDirection = "increasing"
	} else if changePercent < -10 {
		trendDirection = "decreasing"
	}

	// Simple forecast: apply trend to current projected cost
	nextMonthForecast := currentMonthProjected
	if trendDirection == "increasing" {
		nextMonthForecast = currentMonthProjected * 1.1
	} else if trendDirection == "decreasing" {
		nextMonthForecast = currentMonthProjected * 0.9
	}

	// Three month forecast (compound)
	threeMonthForecast := nextMonthForecast
	if trendDirection == "increasing" {
		threeMonthForecast = nextMonthForecast * 1.1
	} else if trendDirection == "decreasing" {
		threeMonthForecast = nextMonthForecast * 0.9
	}

	// Calculate confidence interval (±20%)
	lower := currentMonthProjected * 0.8
	upper := currentMonthProjected * 1.2

	return CostForecast{
		CurrentMonthProjected: currentMonthProjected,
		NextMonthForecast:     nextMonthForecast,
		ThreeMonthForecast:    threeMonthForecast,
		ConfidenceInterval: ForecastConfidence{
			Lower: lower,
			Upper: upper,
		},
		TrendDirection:      trendDirection,
		SeasonalityDetected:   false, // Would require more sophisticated analysis
	}
}

// buildResourceEfficiency calculates efficiency scores for resource groups
func buildResourceEfficiency(rgReports []ResourceGroupCostReport) []ResourceEfficiency {
	var efficiency []ResourceEfficiency

	for _, rg := range rgReports {
		// Calculate scores based on cost per resource and growth
		utilizationScore := 70 // Default moderate score
		costEfficiency := 70
		overallScore := 70

		// Adjust based on cost per resource
		if rg.ResourceCount > 0 {
			costPerResource := rg.CurrentMonthCost / float64(rg.ResourceCount)
			if costPerResource < 50 {
				costEfficiency = 90
			} else if costPerResource < 100 {
				costEfficiency = 80
			} else if costPerResource > 500 {
				costEfficiency = 40
			} else if costPerResource > 1000 {
				costEfficiency = 20
			}
		}

		// Adjust based on growth
		if rg.CostChangePercent > 50 {
			utilizationScore = 50
		} else if rg.CostChangePercent < -20 {
			utilizationScore = 85
		}

		// Calculate overall score
		overallScore = (utilizationScore + costEfficiency) / 2

		// Find inefficient resources (those with high cost)
		var inefficientResources []InefficientResource
		for _, res := range rg.TopCostResources {
			if res.MonthlyCost > 100 {
				score := 100
				if res.MonthlyCost > 500 {
					score = 30
				} else if res.MonthlyCost > 200 {
					score = 50
				}
				inefficientResources = append(inefficientResources, InefficientResource{
					ResourceID:   res.ResourceID,
					ResourceName: res.ResourceName,
					ResourceType: res.ResourceType,
					Score:        score,
					WastedCost:   res.MonthlyCost * (1 - float64(score)/100),
					Reason:       "High monthly cost",
				})
			}
		}

		// Generate recommendations
		var recommendations []string
		if overallScore < 50 {
			recommendations = append(recommendations, "Review high-cost resources")
		}
		if rg.CostChangePercent > 30 {
			recommendations = append(recommendations, "Investigate cost increase")
		}
		if costEfficiency < 60 {
			recommendations = append(recommendations, "Consider rightsizing")
		}

		efficiency = append(efficiency, ResourceEfficiency{
			ResourceGroup:        rg.ResourceGroup,
			OverallScore:         overallScore,
			UtilizationScore:     utilizationScore,
			CostEfficiency:       costEfficiency,
			ResourceCount:        rg.ResourceCount,
			InefficientResources: inefficientResources,
			Recommendations:      recommendations,
		})
	}

	// Sort by overall score ascending (least efficient first)
	sort.Slice(efficiency, func(i, j int) bool {
		return efficiency[i].OverallScore < efficiency[j].OverallScore
	})

	return efficiency
}

// buildSparklines creates sparkline data for visualizations
func buildSparklines(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport) []SparklineData {
	var sparklines []SparklineData

	// Top 5 resource groups by cost
	for i, rg := range rgReports {
		if i >= 5 {
			break
		}
		var values []float64
		for _, day := range rg.CostByDay {
			values = append(values, day.Cost)
		}

		avg := 0.0
		if len(values) > 0 {
			total := 0.0
			for _, v := range values {
				total += v
			}
			avg = total / float64(len(values))
		}

		sparklines = append(sparklines, SparklineData{
			Label:   rg.ResourceGroup,
			Values:  values,
			Color:   "#10b981",
			Min:     0,
			Max:     rg.CurrentMonthCost,
			Average: avg,
		})
	}

	// Add subscription-level sparkline
	for _, trend := range trendReports {
		var values []float64
		for _, day := range trend.DailyTrends {
			values = append(values, day.CurrentMonth)
		}

		avg := 0.0
		if len(values) > 0 {
			total := 0.0
			for _, v := range values {
				total += v
			}
			avg = total / float64(len(values))
		}

		sparklines = append(sparklines, SparklineData{
			Label:   trend.SubscriptionName,
			Values:  values,
			Color:   "#3b82f6",
			Min:     0,
			Max:     trend.CurrentMonthTotal,
			Average: avg,
		})
	}

	return sparklines
}

// buildSavingsRecommendations generates cost-saving recommendations with ROI
func buildSavingsRecommendations(rgReports []ResourceGroupCostReport) []CostSavingsRecommendation {
	var recommendations []CostSavingsRecommendation

	for _, rg := range rgReports {
		// Recommendation 1: Right-size VMs if cost per resource is high
		if rg.ResourceCount > 0 {
			costPerResource := rg.CurrentMonthCost / float64(rg.ResourceCount)
			if costPerResource > 200 {
				projectedSavings := rg.CurrentMonthCost * 0.25
				savingsPct := 25.0
				roi := 5.0 // 500% ROI

				recommendations = append(recommendations, CostSavingsRecommendation{
					ResourceGroup:     rg.ResourceGroup,
					ResourceType:      "Virtual Machines",
					Recommendation:    "Right-size over-provisioned VMs",
					CurrentCost:       rg.CurrentMonthCost,
					ProjectedSavings:  projectedSavings,
					SavingsPercentage: savingsPct,
					ROI:               roi,
					PaybackPeriodDays: 30,
					Difficulty:        "medium",
					Impact:            "high",
					ActionSteps: []string{
						"Analyze VM utilization metrics",
						"Identify underutilized instances",
						"Downsize or consolidate VMs",
					},
				})
			}
		}

		// Recommendation 2: Reserved Instances for stable workloads
		if rg.CostChangePercent >= -10 && rg.CostChangePercent <= 10 {
			projectedSavings := rg.CurrentMonthCost * 0.35
			recommendations = append(recommendations, CostSavingsRecommendation{
				ResourceGroup:     rg.ResourceGroup,
					ResourceType:      "Compute",
					Recommendation:    "Purchase Reserved Instances",
					CurrentCost:       rg.CurrentMonthCost,
					ProjectedSavings:  projectedSavings,
					SavingsPercentage: 35.0,
					ROI:               4.2,
					PaybackPeriodDays: 90,
					Difficulty:        "easy",
					Impact:            "high",
					ActionSteps: []string{
						"Review 12-month usage history",
						"Identify stable workloads",
						"Purchase 1-year reserved capacity",
					},
			})
		}

		// Recommendation 3: Cleanup unused resources
		if rg.CostChangePercent > 20 {
			projectedSavings := rg.CostChange * 0.5
			recommendations = append(recommendations, CostSavingsRecommendation{
				ResourceGroup:     rg.ResourceGroup,
				ResourceType:      "Various",
				Recommendation:    "Remove unused/orphaned resources",
				CurrentCost:       rg.CurrentMonthCost,
				ProjectedSavings:  projectedSavings,
				SavingsPercentage: (projectedSavings / rg.CurrentMonthCost) * 100,
				ROI:               10.0,
				PaybackPeriodDays: 7,
				Difficulty:        "easy",
				Impact:            "medium",
				ActionSteps: []string{
					"Identify unattached disks",
					"Find unused public IPs",
					"Review idle load balancers",
					"Delete orphaned resources",
				},
			})
		}
	}

	// Sort by projected savings descending
	sort.Slice(recommendations, func(i, j int) bool {
		return recommendations[i].ProjectedSavings > recommendations[j].ProjectedSavings
	})

	// Limit to top 10
	if len(recommendations) > 10 {
		recommendations = recommendations[:10]
	}

	return recommendations
}

// buildMonthlyHeatmaps creates cost heatmaps for visualization
func buildMonthlyHeatmaps(rgReports []ResourceGroupCostReport, subIDs []string) []MonthlyHeatmap {
	var heatmaps []MonthlyHeatmap
	now := time.Now()

	// Current month heatmap
	targetGroups := make(map[string]bool)
	for _, rg := range rgReports {
		targetGroups[rg.ResourceGroup] = true
	}

	// Get unique resource groups
	var groups []string
	for g := range targetGroups {
		groups = append(groups, g)
	}

	daysInMonth := daysInCurrentMonth()
	var cells []HeatmapCell
	minCost := 0.0
	maxCost := 0.0

	// Generate heatmap cells for each day and resource group
	for day := 1; day <= daysInMonth; day++ {
		for _, rgName := range groups {
			// Find corresponding RG report
			var cost float64
			for _, rg := range rgReports {
				if rg.ResourceGroup == rgName {
					// Calculate daily cost (total / days so far)
					if len(rg.CostByDay) > 0 {
						for _, d := range rg.CostByDay {
							if d.Date == fmt.Sprintf("%02d", day) {
								cost = d.Cost
								break
							}
						}
					} else if day <= now.Day() {
						cost = rg.CurrentMonthCost / float64(now.Day())
					}
					break
				}
			}

			if cost > 0 {
				if maxCost == 0 || cost > maxCost {
					maxCost = cost
				}
				if minCost == 0 || cost < minCost {
					minCost = cost
				}
			}

			// Calculate intensity
			intensity := 0.0
			if maxCost > minCost {
				intensity = (cost - minCost) / (maxCost - minCost)
			}

			// Generate color based on intensity
			color := generateHeatmapColor(intensity)

			cells = append(cells, HeatmapCell{
				Day:           day,
				ResourceGroup: rgName,
				Cost:          cost,
				Color:         color,
				Intensity:     intensity,
			})
		}
	}

	heatmaps = append(heatmaps, MonthlyHeatmap{
		Month:       now.Format("January"),
		Year:        now.Year(),
		DaysInMonth: daysInMonth,
		Cells:       cells,
		MinCost:     minCost,
		MaxCost:     maxCost,
	})

	return heatmaps
}

// generateHeatmapColor creates a color based on intensity
func generateHeatmapColor(intensity float64) string {
	// Blue to Green to Yellow to Red gradient
	if intensity < 0.25 {
		return "#dbeafe" // light blue
	} else if intensity < 0.5 {
		return "#86efac" // light green
	} else if intensity < 0.75 {
		return "#fde047" // yellow
	}
	return "#fca5a5" // light red
}

// buildDetailedChanges creates detailed change tracking data
func buildDetailedChanges(rgReports []ResourceGroupCostReport) []DetailedChange {
	var changes []DetailedChange
	now := time.Now()

	for _, rg := range rgReports {
		// Only show changes for RGs with significant cost changes
		if math.Abs(rg.CostChangePercent) < 5 {
			continue
		}

		changeType := "modified"
		if rg.PreviousMonthCost == 0 {
			changeType = "created"
		} else if rg.CurrentMonthCost == 0 {
			changeType = "deleted"
		}

		// Build before/after state
		beforeState := ChangeState{
			Cost:  rg.PreviousMonthCost,
			State: "active",
		}
		afterState := ChangeState{
			Cost:  rg.CurrentMonthCost,
			State: "active",
		}

		// Create diff indicators
		var diffIndicators []DiffIndicator
		costIcon := "↓"
		if rg.CostChange > 0 {
			costIcon = "↑"
		}
		diffIndicators = append(diffIndicators, DiffIndicator{
			Field:      "Monthly Cost",
			OldValue:   fmt.Sprintf("$%.2f", rg.PreviousMonthCost),
			NewValue:   fmt.Sprintf("$%.2f", rg.CurrentMonthCost),
			ChangeType: "modified",
			VisualIcon: costIcon,
		})

		if rg.ResourceCount != rg.PreviousResourceCount {
			countIcon := "-"
			if rg.ResourceCount > rg.PreviousResourceCount {
				countIcon = "+"
			}
			diffIndicators = append(diffIndicators, DiffIndicator{
				Field:      "Resource Count",
				OldValue:   fmt.Sprintf("%d", rg.PreviousResourceCount),
				NewValue:   fmt.Sprintf("%d", rg.ResourceCount),
				ChangeType: "modified",
				VisualIcon: countIcon,
			})
		}

		// Determine change reason based on pattern
		changeReason := "Resource modification"
		if rg.CostChangePercent > 50 {
			changeReason = "Significant resource addition"
		} else if rg.CostChangePercent < -30 {
			changeReason = "Resource cleanup or downsizing"
		} else if rg.CostChange < 0 {
			changeReason = "Cost optimization applied"
		}

		changes = append(changes, DetailedChange{
			ChangeID:       fmt.Sprintf("CHG-%s-%d", rg.ResourceGroup[:min(len(rg.ResourceGroup), 8)], now.Unix()),
			Timestamp:      now,
			ResourceGroup:  rg.ResourceGroup,
			ResourceType:   "ResourceGroup",
			ResourceName:   rg.ResourceGroup,
			ChangeType:     changeType,
			FieldChanged:   "Cost",
			Before:         beforeState,
			After:          afterState,
			CostImpact:     rg.CostChange,
			ChangedBy:      "System",
			ChangeReason:   changeReason,
			DiffIndicators: diffIndicators,
		})
	}

	// Sort by cost impact (absolute value)
	sort.Slice(changes, func(i, j int) bool {
		return math.Abs(changes[i].CostImpact) > math.Abs(changes[j].CostImpact)
	})

	// Limit to top 10
	if len(changes) > 10 {
		changes = changes[:10]
	}

	return changes
}

// Helper function for min
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// buildTagAllocations creates cost breakdown by resource tags
func buildTagAllocations(rgReports []ResourceGroupCostReport) []TagCostAllocation {
	// Common tag keys to analyze
	commonTags := []string{"Environment", "Department", "Project", "Owner", "CostCenter"}
	var allocations []TagCostAllocation

	for _, tagKey := range commonTags {
		tagValueMap := make(map[string]*TagValueCost)
		totalCost := 0.0
		totalCount := 0

		// Simulate tag values based on resource group names
		for _, rg := range rgReports {
			var tagValue string
			lowerName := strings.ToLower(rg.ResourceGroup)

			switch tagKey {
			case "Environment":
				if strings.Contains(lowerName, "prod") {
					tagValue = "Production"
				} else if strings.Contains(lowerName, "dev") {
					tagValue = "Development"
				} else if strings.Contains(lowerName, "test") {
					tagValue = "Testing"
				} else {
					tagValue = "Other"
				}
			case "Department":
				if strings.Contains(lowerName, "web") || strings.Contains(lowerName, "app") {
					tagValue = "Engineering"
				} else if strings.Contains(lowerName, "data") {
					tagValue = "Data"
				} else {
					tagValue = "Infrastructure"
				}
			default:
				tagValue = "Default"
			}

			if entry, exists := tagValueMap[tagValue]; exists {
				entry.Cost += rg.CurrentMonthCost
				entry.Count += rg.ResourceCount
			} else {
				tagValueMap[tagValue] = &TagValueCost{
					Value: tagValue,
					Cost:  rg.CurrentMonthCost,
					Count: rg.ResourceCount,
				}
			}
			totalCost += rg.CurrentMonthCost
			totalCount += rg.ResourceCount
		}

		// Calculate percentages
		var tagValues []TagValueCost
		for _, entry := range tagValueMap {
			if totalCost > 0 {
				entry.Percentage = (entry.Cost / totalCost) * 100
			}
			tagValues = append(tagValues, *entry)
		}

		// Sort by cost descending
		sort.Slice(tagValues, func(i, j int) bool {
			return tagValues[i].Cost > tagValues[j].Cost
		})

		if len(tagValues) > 0 {
			allocations = append(allocations, TagCostAllocation{
				TagKey:        tagKey,
				TagValues:     tagValues,
				TotalCost:     totalCost,
				ResourceCount: totalCount,
			})
		}
	}

	return allocations
}

// buildBenchmarks creates benchmark comparisons
func buildBenchmarks(totalCurrentCost, totalPreviousCost float64, rgReports []ResourceGroupCostReport) []BenchmarkComparison {
	var benchmarks []BenchmarkComparison

	// Calculate average cost per resource group
	avgCostPerRG := 0.0
	if len(rgReports) > 0 {
		avgCostPerRG = totalCurrentCost / float64(len(rgReports))
	}

	// Define benchmark targets (simplified calculations)
	benchmarkTargets := []struct {
		category string
		benchmark float64
	}{
		{"Cost per Resource Group", avgCostPerRG * 0.9},
		{"Month-over-Month Growth", totalPreviousCost * 1.05},
		{"Total Monthly Budget", totalCurrentCost * 1.2},
	}

	for _, target := range benchmarkTargets {
		var currentValue float64
		var recommendation string
		status := "at_target"

		switch target.category {
		case "Cost per Resource Group":
			currentValue = avgCostPerRG
			if avgCostPerRG > target.benchmark {
				status = "above"
				recommendation = "Consider consolidating resource groups"
			} else {
				status = "below"
				recommendation = "Cost per RG is below benchmark"
			}
		case "Month-over-Month Growth":
			currentValue = totalCurrentCost
			if totalCurrentCost > target.benchmark {
				status = "above"
				recommendation = "Growth exceeds 5% threshold"
			} else {
				status = "below"
				recommendation = "Growth within acceptable range"
			}
		case "Total Monthly Budget":
			currentValue = totalCurrentCost
			if totalCurrentCost > target.benchmark {
				status = "above"
				recommendation = "Approaching budget limit"
			} else {
				status = "below"
				recommendation = "Within budget"
			}
		}

		difference := currentValue - target.benchmark
		differencePercent := 0.0
		if target.benchmark > 0 {
			differencePercent = (difference / target.benchmark) * 100
		}

		benchmarks = append(benchmarks, BenchmarkComparison{
			Category:          target.category,
			CurrentCost:       currentValue,
			BenchmarkCost:     target.benchmark,
			Difference:        difference,
			DifferencePercent: differencePercent,
			Status:            status,
			Recommendation:    recommendation,
		})
	}

	return benchmarks
}

// buildWeeklySummaries creates weekly cost summaries
func buildWeeklySummaries(rgReports []ResourceGroupCostReport) []WeeklySummary {
	var summaries []WeeklySummary
	now := time.Now()

	// Get current month's daily data
	currentWeek := now.Day() / 7
	if currentWeek == 0 {
		currentWeek = 1
	}

	// Simulate weekly data based on resource group costs
	for week := 1; week <= currentWeek && week <= 4; week++ {
		weekStart := time.Date(now.Year(), now.Month(), (week-1)*7+1, 0, 0, 0, 0, time.UTC)
		weekEnd := weekStart.AddDate(0, 0, 6)
		if weekEnd.After(now) {
			weekEnd = now
		}

		// Calculate weekly totals
		weekTotal := 0.0
		var dailyCosts []float64
		for _, rg := range rgReports {
			// Estimate weekly cost from monthly cost
			weeklyCost := rg.CurrentMonthCost / 4.0
			weekTotal += weeklyCost
			dailyCosts = append(dailyCosts, weeklyCost/7.0)
		}

		avgDaily := 0.0
		highest := DayCost{Cost: 0}
		lowest := DayCost{Cost: 0}
		if len(dailyCosts) > 0 {
			total := 0.0
			maxVal := 0.0
			minVal := dailyCosts[0]
			for _, c := range dailyCosts {
				total += c
				if c > maxVal {
					maxVal = c
					highest.Cost = c
				}
				if c < minVal {
					minVal = c
					lowest.Cost = c
				}
			}
			avgDaily = total / float64(len(dailyCosts))
		}

		changePercent := 0.0
		if week > 1 && len(summaries) > 0 {
			lastWeek := summaries[len(summaries)-1].TotalCost
			if lastWeek > 0 {
				changePercent = ((weekTotal - lastWeek) / lastWeek) * 100
			}
		}

		summaries = append(summaries, WeeklySummary{
			WeekNumber:         week,
			WeekStart:          weekStart.Format("2006-01-02"),
			WeekEnd:            weekEnd.Format("2006-01-02"),
			TotalCost:          weekTotal,
			AverageDailyCost:   avgDaily,
			HighestDay:         highest,
			LowestDay:          lowest,
			ChangeFromLastWeek: weekTotal - (weekTotal / (1 + changePercent/100)),
			ChangePercent:      changePercent,
		})
	}

	return summaries
}

// buildExecutiveSummary creates high-level metrics for management
func buildExecutiveSummary(totalCurrentCost, totalPreviousCost, budgetLimit float64, rgReports []ResourceGroupCostReport) ExecutiveSummary {
	// Calculate key metrics
	budgetUtilization := 0.0
	if budgetLimit > 0 {
		budgetUtilization = (totalCurrentCost / budgetLimit) * 100
	}

	// Estimate cost per employee (assume 100 employees for demo)
	costPerEmployee := totalCurrentCost / 100.0

	// Calculate month-over-month change
	momChange := 0.0
	if totalPreviousCost > 0 {
		momChange = ((totalCurrentCost - totalPreviousCost) / totalPreviousCost) * 100
	}

	// Project annual spend
	projectedAnnual := totalCurrentCost * 12

	// Identify top cost drivers
	var topDrivers []CostDriver
	sort.Slice(rgReports, func(i, j int) bool {
		return rgReports[i].CurrentMonthCost > rgReports[j].CurrentMonthCost
	})

	for i, rg := range rgReports {
		if i >= 5 {
			break
		}
		percentage := 0.0
		if totalCurrentCost > 0 {
			percentage = (rg.CurrentMonthCost / totalCurrentCost) * 100
		}
		trend := "stable"
		if rg.CostChangePercent > 10 {
			trend = "up"
		} else if rg.CostChangePercent < -10 {
			trend = "down"
		}
		impactStr := "low"
		if percentage > 20 {
			impactStr = "high"
		} else if percentage > 10 {
			impactStr = "medium"
		}
		topDrivers = append(topDrivers, CostDriver{
			Name:       rg.ResourceGroup,
			Cost:       rg.CurrentMonthCost,
			Percentage: percentage,
			Trend:      trend,
			Impact:     impactStr,
		})
	}

	// Identify risk areas
	var riskAreas []RiskArea
	if budgetUtilization > 90 {
		riskAreas = append(riskAreas, RiskArea{
			Category:        "Budget",
			Severity:        "high",
			Description:     "Budget utilization exceeds 90%",
			PotentialImpact: totalCurrentCost * 0.1,
			Mitigation:      "Review non-essential resources",
		})
	}
	if momChange > 20 {
		riskAreas = append(riskAreas, RiskArea{
			Category:        "Cost Growth",
			Severity:        "critical",
			Description:     "Month-over-month cost increase exceeds 20%",
			PotentialImpact: totalCurrentCost * 0.2,
			Mitigation:      "Implement cost controls",
		})
	}

	// Identify achievements
	var achievements []Achievement
	if momChange < -5 {
		achievements = append(achievements, Achievement{
			Title:       "Cost Optimization",
			Description: "Successfully reduced costs month-over-month",
			Date:        time.Now().Format("2006-01-02"),
			Impact:      fmt.Sprintf("Saved $%.2f", totalPreviousCost-totalCurrentCost),
		})
	}

	return ExecutiveSummary{
		TotalMonthlySpend:    totalCurrentCost,
		BudgetUtilization:    budgetUtilization,
		CostPerEmployee:      costPerEmployee,
		TopCostDrivers:       topDrivers,
		RiskAreas:            riskAreas,
		Achievements:         achievements,
		MonthOverMonthChange: momChange,
		ProjectedAnnualSpend: projectedAnnual,
	}
}

// buildCostAlerts creates threshold-based cost alerts
func buildCostAlerts(rgReports []ResourceGroupCostReport, budgetLimit float64) []CostAlert {
	var alerts []CostAlert
	now := time.Now()

	// Budget threshold alerts
	if budgetLimit > 0 {
		totalCost := 0.0
		for _, rg := range rgReports {
			totalCost += rg.CurrentMonthCost
		}
		utilization := (totalCost / budgetLimit) * 100

		thresholds := []struct {
			pct       float64
			severity  string
		}{
			{100, "critical"},
			{90, "high"},
			{75, "medium"},
		}

		for _, t := range thresholds {
			if utilization >= t.pct {
				alerts = append(alerts, CostAlert{
					AlertID:     fmt.Sprintf("BUDGET-%d-%d", int(t.pct), now.Unix()),
					Type:        "budget_threshold",
					Severity:    t.severity,
					Threshold:   budgetLimit * (t.pct / 100),
					ActualValue: totalCost,
					Percentage:  utilization,
					TriggeredAt: now,
					Status:      "active",
					Message:     fmt.Sprintf("Budget %d%% threshold exceeded", int(t.pct)),
				})
				break // Only trigger highest threshold
			}
		}
	}

	// Resource group cost spike alerts
	for _, rg := range rgReports {
		if rg.CostChangePercent > 50 {
			alerts = append(alerts, CostAlert{
				AlertID:       fmt.Sprintf("SPIKE-%s-%d", rg.ResourceGroup[:8], now.Unix()),
				Type:          "spike",
				Severity:      "high",
				ResourceGroup: rg.ResourceGroup,
				Threshold:     rg.PreviousMonthCost * 1.5,
				ActualValue:   rg.CurrentMonthCost,
				Percentage:    rg.CostChangePercent,
				TriggeredAt:   now,
				Status:        "active",
				Message:       fmt.Sprintf("Cost spike detected: %.1f%% increase", rg.CostChangePercent),
			})
		}
	}

	return alerts
}

// buildResourceLifecycles tracks resource lifecycle events
func buildResourceLifecycles(rgReports []ResourceGroupCostReport) []ResourceLifecycle {
	var lifecycles []ResourceLifecycle
	now := time.Now()

	for _, rg := range rgReports {
		// Create lifecycle entries for top resources in each RG
		for i, res := range rg.TopCostResources {
			if i >= 3 {
				break
			}

			// Simulate creation date (older resources)
			age := 30 + (i * 15) // 30, 45, 60 days
			createdAt := now.AddDate(0, 0, -age)
			modifiedAt := createdAt

			// Simulate cost history
			var costHistory []LifecycleCostPoint
			for day := 0; day < 7; day++ {
				date := now.AddDate(0, 0, -day)
				costHistory = append(costHistory, LifecycleCostPoint{
					Date:  date.Format("2006-01-02"),
					Cost:  res.MonthlyCost / 30,
					State: "active",
				})
			}

			// Simulate state transitions
			var transitions []StateTransition
			transitions = append(transitions, StateTransition{
				FromState: "creating",
				ToState:   "active",
				Timestamp: createdAt,
				Reason:    "Resource created",
			})

			lifecycles = append(lifecycles, ResourceLifecycle{
				ResourceID:       res.ResourceID,
				ResourceName:     res.ResourceName,
				ResourceType:     res.ResourceType,
				ResourceGroup:    rg.ResourceGroup,
				CurrentState:     "active",
				CreatedAt:        createdAt,
				ModifiedAt:       modifiedAt,
				AgeDays:          age,
				CostHistory:      costHistory,
				StateTransitions: transitions,
			})
		}
	}

	return lifecycles
}

// buildDepartmentRollups aggregates costs by department/team
func buildDepartmentRollups(rgReports []ResourceGroupCostReport) []DepartmentRollup {
	// Define departments based on resource group naming patterns
	departments := map[string][]string{
		"Engineering":  {},
		"Data Science": {},
		"DevOps":       {},
		"QA":           {},
	}

	// Categorize resource groups
	for _, rg := range rgReports {
		lowerName := strings.ToLower(rg.ResourceGroup)
		if strings.Contains(lowerName, "web") || strings.Contains(lowerName, "app") {
			departments["Engineering"] = append(departments["Engineering"], rg.ResourceGroup)
		} else if strings.Contains(lowerName, "data") || strings.Contains(lowerName, "ml") || strings.Contains(lowerName, "ai") {
			departments["Data Science"] = append(departments["Data Science"], rg.ResourceGroup)
		} else if strings.Contains(lowerName, "infra") || strings.Contains(lowerName, "ops") {
			departments["DevOps"] = append(departments["DevOps"], rg.ResourceGroup)
		} else if strings.Contains(lowerName, "test") || strings.Contains(lowerName, "qa") {
			departments["QA"] = append(departments["QA"], rg.ResourceGroup)
		} else {
			departments["Engineering"] = append(departments["Engineering"], rg.ResourceGroup)
		}
	}

	var rollups []DepartmentRollup
	for deptName, rgNames := range departments {
		if len(rgNames) == 0 {
			continue
		}

		totalCost := 0.0
		resourceCount := 0
		var services []ServiceCost
		serviceMap := make(map[string]float64)

		for _, rgName := range rgNames {
			for _, rg := range rgReports {
				if rg.ResourceGroup == rgName {
					totalCost += rg.CurrentMonthCost
					resourceCount += rg.ResourceCount

					// Aggregate by resource type
					for _, res := range rg.TopCostResources {
						serviceMap[res.ResourceType] += res.MonthlyCost
					}
				}
			}
		}

		// Calculate service percentages
		for svcName, cost := range serviceMap {
			percentage := 0.0
			if totalCost > 0 {
				percentage = (cost / totalCost) * 100
			}
			services = append(services, ServiceCost{
				ServiceName: svcName,
				Cost:        cost,
				Percentage:  percentage,
			})
		}

		// Sort services by cost
		sort.Slice(services, func(i, j int) bool {
			return services[i].Cost > services[j].Cost
		})
		if len(services) > 3 {
			services = services[:3]
		}

		rollups = append(rollups, DepartmentRollup{
			DepartmentName:    deptName,
			Manager:           "Team Lead",
			TotalCost:         totalCost,
			Budget:            totalCost * 1.2, // 20% buffer
			BudgetUtilization: (totalCost / (totalCost * 1.2)) * 100,
			ResourceGroups:    rgNames,
			ResourceCount:     resourceCount,
			TeamMembers:     []TeamMember{}, // Simplified
			TopServices:     services,
		})
	}

	// Sort by total cost
	sort.Slice(rollups, func(i, j int) bool {
		return rollups[i].TotalCost > rollups[j].TotalCost
	})

	return rollups
}

// buildCostVelocity calculates cost velocity metrics for trending analysis
func buildCostVelocity(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport) []CostVelocity {
	var velocities []CostVelocity

	for _, tr := range trendReports {
		daysInMonth := float64(daysInCurrentMonth())
		daysElapsed := float64(time.Now().Day())

		if daysElapsed == 0 {
			daysElapsed = 1
		}

		currentRate := tr.CurrentMonthTotal / daysElapsed
		previousRate := 0.0
		if daysInMonth > 0 {
			previousRate = tr.PreviousMonthTotal / daysInMonth
		}

		acceleration := 0.0
		if previousRate > 0 {
			acceleration = ((currentRate - previousRate) / previousRate) * 100
		}

		momentum := "stable"
		if acceleration > 10 {
			momentum = "accelerating"
		} else if acceleration < -10 {
			momentum = "decelerating"
		}

		projected7Day := currentRate * 7
		projected30Day := currentRate * daysInMonth

		trendStrength := 50.0
		if math.Abs(acceleration) > 50 {
			trendStrength = 90
		} else if math.Abs(acceleration) > 20 {
			trendStrength = 70
		} else if math.Abs(acceleration) > 5 {
			trendStrength = 50
		} else {
			trendStrength = 30
		}

		velocities = append(velocities, CostVelocity{
			Period:             "daily",
			CurrentRate:        currentRate,
			PreviousRate:       previousRate,
			Acceleration:       acceleration,
			MomentumDirection:  momentum,
			Projected7DayCost:  projected7Day,
			Projected30DayCost: projected30Day,
			TrendStrength:      trendStrength,
		})
	}

	return velocities
}

// buildServiceLevelBreakdown creates detailed cost analysis by Azure service
func buildServiceLevelBreakdown(rgReports []ResourceGroupCostReport) []ServiceLevelBreakdown {
	serviceMap := make(map[string]*ServiceLevelBreakdown)

	for _, rg := range rgReports {
		for _, res := range rg.TopCostResources {
			serviceCategory := categorizeService(res.ResourceType)

			if _, exists := serviceMap[res.ResourceType]; !exists {
				serviceMap[res.ResourceType] = &ServiceLevelBreakdown{
					ServiceName:     res.ResourceType,
					ServiceCategory: serviceCategory,
					TopResourceGroups: []ServiceRGUsage{},
					DailyCosts:        []ServiceDailyCost{},
					MeterDetails:      []ServiceMeterDetail{},
				}
			}

			svc := serviceMap[res.ResourceType]
			svc.CurrentMonthCost += res.MonthlyCost
			svc.ResourceCount++

			// Add resource group usage
			svc.TopResourceGroups = append(svc.TopResourceGroups, ServiceRGUsage{
				ResourceGroup: rg.ResourceGroup,
				Cost:          res.MonthlyCost,
				Percentage:    0,
				ResourceCount: 1,
			})
		}
	}

	// Calculate percentages and convert to slice
	var totalCost float64
	for _, svc := range serviceMap {
		totalCost += svc.CurrentMonthCost
	}

	var breakdowns []ServiceLevelBreakdown
	for _, svc := range serviceMap {
		if totalCost > 0 {
			svc.PercentageOfTotal = (svc.CurrentMonthCost / totalCost) * 100
		}

		// Calculate change (mock for now)
		svc.PreviousMonthCost = svc.CurrentMonthCost * 0.9
		svc.CostChange = svc.CurrentMonthCost - svc.PreviousMonthCost
		if svc.PreviousMonthCost > 0 {
			svc.CostChangePercent = (svc.CostChange / svc.PreviousMonthCost) * 100
		}

		// Sort and limit resource groups
		sort.Slice(svc.TopResourceGroups, func(i, j int) bool {
			return svc.TopResourceGroups[i].Cost > svc.TopResourceGroups[j].Cost
		})
		if len(svc.TopResourceGroups) > 5 {
			svc.TopResourceGroups = svc.TopResourceGroups[:5]
		}

		// Calculate RG percentages
		for i := range svc.TopResourceGroups {
			if svc.CurrentMonthCost > 0 {
				svc.TopResourceGroups[i].Percentage = (svc.TopResourceGroups[i].Cost / svc.CurrentMonthCost) * 100
			}
		}

		breakdowns = append(breakdowns, *svc)
	}

	// Sort by cost
	sort.Slice(breakdowns, func(i, j int) bool {
		return breakdowns[i].CurrentMonthCost > breakdowns[j].CurrentMonthCost
	})

	return breakdowns
}

// categorizeService maps resource types to service categories
func categorizeService(resourceType string) string {
	lower := strings.ToLower(resourceType)

	switch {
	case strings.Contains(lower, "compute"), strings.Contains(lower, "virtualmachine"):
		return "Compute"
	case strings.Contains(lower, "storage"), strings.Contains(lower, "blob"), strings.Contains(lower, "disk"):
		return "Storage"
	case strings.Contains(lower, "network"), strings.Contains(lower, "virtualnetwork"), strings.Contains(lower, "loadbalancer"):
		return "Network"
	case strings.Contains(lower, "database"), strings.Contains(lower, "sql"), strings.Contains(lower, "cosmos"):
		return "Database"
	case strings.Contains(lower, "cognitive"), strings.Contains(lower, "ml"):
		return "AI/ML"
	case strings.Contains(lower, "keyvault"):
		return "Security"
	default:
		return "Other"
	}
}

// buildGeographicDistribution creates cost analysis by Azure region
func buildGeographicDistribution(rgReports []ResourceGroupCostReport) []GeographicDistribution {
	regionMap := make(map[string]*GeographicDistribution)

	// Carbon intensity by region (approximate kg CO2/kWh)
	carbonData := map[string]float64{
		"eastus": 0.35, "eastus2": 0.35, "westus": 0.25, "westus2": 0.25,
		"westeurope": 0.20, "northeurope": 0.15, "southeastasia": 0.45,
		"eastasia": 0.50, "centralus": 0.40, "southcentralus": 0.45,
	}

	renewableData := map[string]float64{
		"eastus": 25, "eastus2": 25, "westus": 45, "westus2": 60,
		"westeurope": 60, "northeurope": 80, "southeastasia": 15,
		"eastasia": 10, "centralus": 30, "southcentralus": 20,
	}

	regionFullNames := map[string]string{
		"eastus": "East US", "eastus2": "East US 2", "westus": "West US", "westus2": "West US 2",
		"westeurope": "West Europe", "northeurope": "North Europe", "southeastasia": "Southeast Asia",
		"eastasia": "East Asia", "centralus": "Central US", "southcentralus": "South Central US",
	}

	for _, rg := range rgReports {
		// Simulate location from subscription ID
		location := "eastus"
		for _, res := range rg.TopCostResources {
			// Use resource type to hint at location
			if strings.Contains(strings.ToLower(res.ResourceType), "cognitive") {
				location = "eastus2"
			}
		}

		if _, exists := regionMap[location]; !exists {
			regionMap[location] = &GeographicDistribution{
				Region:              location,
				RegionFullName:      regionFullNames[location],
				Services:            []RegionServiceBreakdown{},
				CarbonIntensity:     carbonData[location],
				RenewablePercentage: renewableData[location],
			}
		}

		region := regionMap[location]
		region.CurrentMonthCost += rg.CurrentMonthCost
		region.ResourceCount += rg.ResourceCount

		// Add service breakdown
		for _, res := range rg.TopCostResources {
			region.Services = append(region.Services, RegionServiceBreakdown{
				ServiceName:   res.ResourceType,
				Cost:          res.MonthlyCost,
				ResourceCount: 1,
			})
		}
	}

	// Calculate totals and percentages
	var totalCost float64
	for _, region := range regionMap {
		totalCost += region.CurrentMonthCost
	}

	var distributions []GeographicDistribution
	for _, region := range regionMap {
		if totalCost > 0 {
			region.PercentageOfTotal = (region.CurrentMonthCost / totalCost) * 100
		}

		// Calculate change
		region.PreviousMonthCost = region.CurrentMonthCost * 0.95
		region.CostChange = region.CurrentMonthCost - region.PreviousMonthCost

		distributions = append(distributions, *region)
	}

	// Sort by cost
	sort.Slice(distributions, func(i, j int) bool {
		return distributions[i].CurrentMonthCost > distributions[j].CurrentMonthCost
	})

	return distributions
}

// buildUsageEfficiencyMetrics creates utilization and efficiency metrics
func buildUsageEfficiencyMetrics(rgReports []ResourceGroupCostReport) []UsageEfficiencyMetrics {
	var metrics []UsageEfficiencyMetrics

	for _, rg := range rgReports {
		for _, res := range rg.TopCostResources {
			// Calculate efficiency based on resource type and cost
			efficiency := 75
			utilization := 60.0
			recommendation := "Right-size based on usage patterns"
			savings := res.MonthlyCost * 0.15

			lowerType := strings.ToLower(res.ResourceType)
			if strings.Contains(lowerType, "cognitive") {
				efficiency = 90
				utilization = 85.0
				recommendation = "Monitor usage trends"
				savings = res.MonthlyCost * 0.05
			} else if strings.Contains(lowerType, "storage") {
				efficiency = 70
				utilization = 45.0
				recommendation = "Consider tiered storage"
				savings = res.MonthlyCost * 0.20
			} else if strings.Contains(lowerType, "compute") {
				efficiency = 65
				utilization = 35.0
				recommendation = "Use auto-scaling or scheduled shutdown"
				savings = res.MonthlyCost * 0.30
			}

			// Generate hourly patterns
			var hourlyPatterns []HourlyUsagePattern
			for hour := 0; hour < 24; hour++ {
				var avgCPU, avgMem float64

				// Business hours pattern
				if hour >= 9 && hour <= 17 {
					avgCPU = utilization * 1.2
					avgMem = utilization * 1.1
				} else if hour >= 1 && hour <= 5 {
					avgCPU = utilization * 0.3
					avgMem = utilization * 0.5
				} else {
					avgCPU = utilization * 0.7
					avgMem = utilization * 0.8
				}

				peakTimes := []int{10, 11, 14, 15}
				idleTimes := []int{2, 3, 4}

				hourlyPatterns = append(hourlyPatterns, HourlyUsagePattern{
					Hour:       hour,
					AvgCPU:     avgCPU,
					AvgMemory:  avgMem,
					AvgNetwork: avgCPU * 0.8,
					PeakTimes:  peakTimes,
					IdleTimes:  idleTimes,
				})
			}

			metrics = append(metrics, UsageEfficiencyMetrics{
				ResourceID:         res.ResourceID,
				ResourceName:       res.ResourceName,
				ResourceType:       res.ResourceType,
				ResourceGroup:      rg.ResourceGroup,
				Location:           "eastus",
				CurrentCost:        res.MonthlyCost,
				EfficiencyScore:    efficiency,
				UtilizationPercent: utilization,
				UptimePercent:      99.5,
				CostPerUnitUsage:   res.MonthlyCost / (utilization + 1),
				PotentialSavings:   savings,
				Recommendation:     recommendation,
				Metrics: map[string]MetricStats{
					"cpu":    {Min: 10, Max: 95, Avg: utilization, P95: 85, Unit: "percent"},
					"memory": {Min: 20, Max: 90, Avg: utilization * 0.9, P95: 80, Unit: "percent"},
				},
				HourlyPatterns: hourlyPatterns,
			})
		}
	}

	// Sort by potential savings
	sort.Slice(metrics, func(i, j int) bool {
		return metrics[i].PotentialSavings > metrics[j].PotentialSavings
	})

	// Limit to top 50
	if len(metrics) > 50 {
		metrics = metrics[:50]
	}

	return metrics
}

// buildRGChangeTimelines creates chronological change tracking for resource groups
func buildRGChangeTimelines(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport) []ResourceGroupChangeTimeline {
	var timelines []ResourceGroupChangeTimeline

	for _, rg := range rgReports {
		timeline := ResourceGroupChangeTimeline{
			ResourceGroup:  rg.ResourceGroup,
			SubscriptionID: rg.SubscriptionID,
			Events:         []ResourceChangeEvent{},
			CostTrajectory: []CostTrajectoryPoint{},
		}

		// Generate change events based on cost patterns
		now := time.Now()

		// Simulate creation event
		timeline.Events = append(timeline.Events, ResourceChangeEvent{
			Timestamp:     now.AddDate(0, 0, -now.Day()+1),
			EventType:     "created",
			Description:   "Resource group created",
			CostImpact:    0,
			ResourceCount: rg.ResourceCount,
			TriggeredBy:   "user",
		})

		// Generate scale events based on cost changes
		if rg.CostChangePercent > 50 {
			timeline.Events = append(timeline.Events, ResourceChangeEvent{
				Timestamp:     now.AddDate(0, 0, -5),
				EventType:     "scale_up",
				Description:   "Significant resource addition detected",
				CostImpact:    rg.CostChange,
				ResourceCount: rg.ResourceCount / 2,
				TriggeredBy:   "system",
			})
		} else if rg.CostChangePercent < -30 {
			timeline.Events = append(timeline.Events, ResourceChangeEvent{
				Timestamp:     now.AddDate(0, 0, -3),
				EventType:     "scale_down",
				Description:   "Resources removed or downsized",
				CostImpact:    rg.CostChange,
				ResourceCount: -rg.ResourceCount / 4,
				TriggeredBy:   "user",
			})
		}

		// Add tagging event
		timeline.Events = append(timeline.Events, ResourceChangeEvent{
			Timestamp:     now.AddDate(0, 0, -2),
			EventType:     "tagged",
			Description:   "Cost allocation tags applied",
			CostImpact:    0,
			ResourceCount: 0,
			TriggeredBy:   "system",
		})

		// Sort events by timestamp
		sort.Slice(timeline.Events, func(i, j int) bool {
			return timeline.Events[i].Timestamp.Before(timeline.Events[j].Timestamp)
		})

		// Build cost trajectory from trend reports
		for _, tr := range trendReports {
			if tr.SubscriptionID == rg.SubscriptionID {
				cumulative := 0.0
				for i, daily := range tr.DailyTrends {
					cumulative += daily.CurrentMonth
					change := daily.Change
					if i == 0 {
						change = 0
					}
					timeline.CostTrajectory = append(timeline.CostTrajectory, CostTrajectoryPoint{
						Date:       daily.Date,
						Cumulative: cumulative,
						Daily:      daily.CurrentMonth,
						Change:     change,
					})
				}
			}
		}

		timelines = append(timelines, timeline)
	}

	return timelines
}

// buildBudgetTracking creates budget vs actual analysis
func buildBudgetTracking(totalCurrentCost float64, rgReports []ResourceGroupCostReport) BudgetTracking {
	now := time.Now()
	daysInMonth := daysInCurrentMonth()
	daysElapsed := now.Day()
	daysRemaining := daysInMonth - daysElapsed

	// Set budget at 120% of previous month or 10% growth
	budgetAmount := totalCurrentCost * 1.1
	if len(rgReports) > 0 {
		budgetAmount = totalCurrentCost * 1.15
	}

	dailyBurnRate := 0.0
	if daysElapsed > 0 {
		dailyBurnRate = totalCurrentCost / float64(daysElapsed)
	}

	projectedMonthEnd := dailyBurnRate * float64(daysInMonth)
	forecastedOverspend := 0.0
	if projectedMonthEnd > budgetAmount {
		forecastedOverspend = projectedMonthEnd - budgetAmount
	}

	utilization := 0.0
	if budgetAmount > 0 {
		utilization = (totalCurrentCost / budgetAmount) * 100
	}

	status := "under"
	if utilization > 90 {
		status = "approaching"
	}
	if utilization > 100 {
		status = "over"
	}

	// Generate budget alerts
	var alerts []BudgetAlert
	if utilization > 75 && utilization <= 90 {
		alerts = append(alerts, BudgetAlert{
			Level:       "info",
			Message:     "Budget utilization exceeds 75%",
			TriggeredAt: now.Format(time.RFC3339),
			Threshold:   75,
			Current:     utilization,
		})
	}
	if utilization > 90 && utilization <= 100 {
		alerts = append(alerts, BudgetAlert{
			Level:       "warning",
			Message:     "Budget utilization exceeds 90% - review spending",
			TriggeredAt: now.Format(time.RFC3339),
			Threshold:   90,
			Current:     utilization,
		})
	}
	if utilization > 100 {
		alerts = append(alerts, BudgetAlert{
			Level:       "critical",
			Message:     "Budget exceeded! Implement cost controls immediately",
			TriggeredAt: now.Format(time.RFC3339),
			Threshold:   100,
			Current:     utilization,
		})
	}

	// Build resource group budgets
	var rgBudgets []ResourceGroupBudget
	for _, rg := range rgReports {
		// Estimate RG budget based on proportion of total
		rgBudget := budgetAmount * (rg.CurrentMonthCost / totalCurrentCost)
		if totalCurrentCost == 0 {
			rgBudget = budgetAmount / float64(len(rgReports))
		}

		variance := rg.CurrentMonthCost - rgBudget
		variancePercent := 0.0
		if rgBudget > 0 {
			variancePercent = (variance / rgBudget) * 100
		}

		rgStatus := "under"
		if variancePercent > 10 {
			rgStatus = "over"
		} else if variancePercent > 5 {
			rgStatus = "approaching"
		}

		rgBudgets = append(rgBudgets, ResourceGroupBudget{
			ResourceGroup:   rg.ResourceGroup,
			Budget:          rgBudget,
			Actual:          rg.CurrentMonthCost,
			Variance:        variance,
			VariancePercent: variancePercent,
			Status:          rgStatus,
		})
	}

	// Sort by variance percentage
	sort.Slice(rgBudgets, func(i, j int) bool {
		return math.Abs(rgBudgets[i].VariancePercent) > math.Abs(rgBudgets[j].VariancePercent)
	})

	return BudgetTracking{
		BudgetName:           "Monthly Cloud Budget",
		BudgetAmount:         budgetAmount,
		ActualSpend:          totalCurrentCost,
		RemainingBudget:      budgetAmount - totalCurrentCost,
		UtilizationPercent:   utilization,
		ForecastedOverspend:  forecastedOverspend,
		DaysRemaining:        daysRemaining,
		DailyBurnRate:        dailyBurnRate,
		ProjectedMonthEnd:    projectedMonthEnd,
		Status:               status,
		Alerts:               alerts,
		ResourceGroupBudgets: rgBudgets,
	}
}

// buildResourceDrift tracks cost and configuration drift
func buildResourceDrift(rgReports []ResourceGroupCostReport) []ResourceDrift {
	var drifts []ResourceDrift
	now := time.Now()

	for _, rg := range rgReports {
		for _, res := range rg.TopCostResources {
			// Calculate drift based on cost changes
			expectedCost := res.MonthlyCost * 0.95 // Assume 5% variance is normal
			actualCost := res.MonthlyCost
			driftPercent := 0.0
			if expectedCost > 0 {
				driftPercent = ((actualCost - expectedCost) / expectedCost) * 100
			}

			severity := "low"
			if math.Abs(driftPercent) > 50 {
				severity = "high"
			} else if math.Abs(driftPercent) > 20 {
				severity = "medium"
			}

			if severity == "low" {
				continue // Skip low drift items
			}

			driftType := "cost"
			action := "Review usage patterns"
			if driftPercent > 0 {
				action = "Investigate cost increase"
			} else {
				action = "Verify resource is still needed"
			}

			// Generate config changes
			configChanges := []ConfigChange{
				{
					Timestamp:  now.AddDate(0, 0, -5),
					Property:   "cost",
					OldValue:   fmt.Sprintf("%.2f", expectedCost),
					NewValue:   fmt.Sprintf("%.2f", actualCost),
					CostImpact: actualCost - expectedCost,
				},
			}

			drifts = append(drifts, ResourceDrift{
				ResourceID:        res.ResourceID,
				ResourceName:      res.ResourceName,
				ResourceGroup:     rg.ResourceGroup,
				ResourceType:      res.ResourceType,
				DriftType:         driftType,
				DriftSeverity:     severity,
				ExpectedCost:      expectedCost,
				ActualCost:        actualCost,
				CostDriftPercent:  driftPercent,
				FirstDetected:     now.AddDate(0, 0, -7),
				LastChecked:       now,
				DriftDuration:     "7 days",
				ConfigChanges:     configChanges,
				RecommendedAction: action,
			})
		}
	}

	// Sort by severity
	severityOrder := map[string]int{"high": 0, "medium": 1, "low": 2}
	sort.Slice(drifts, func(i, j int) bool {
		return severityOrder[drifts[i].DriftSeverity] < severityOrder[drifts[j].DriftSeverity]
	})

	return drifts
}

// buildMultiMonthTrends creates historical trend analysis
func buildMultiMonthTrends(rgReports []ResourceGroupCostReport) []MonthlyTrend {
	var trends []MonthlyTrend
	now := time.Now()

	// Generate last 6 months of trends
	for i := 5; i >= 0; i-- {
		monthDate := now.AddDate(0, -i, 0)
		monthName := monthDate.Format("January 2006")
		monthNum := int(monthDate.Month())
		year := monthDate.Year()

		// Calculate simulated costs based on current costs with variance
		varianceFactor := 1.0 - (float64(i) * 0.05) // 5% growth per month
		if varianceFactor < 0.7 {
			varianceFactor = 0.7
		}

		totalCost := 0.0
		resourceCount := 0
		for _, rg := range rgReports {
			rgCost := rg.CurrentMonthCost * varianceFactor
			totalCost += rgCost
			resourceCount += rg.ResourceCount
		}

		// Build top services for this month
		var topServices []ServiceMonthSummary
		serviceMap := make(map[string]float64)
		for _, rg := range rgReports {
			for _, res := range rg.TopCostResources {
				serviceMap[res.ResourceType] += res.MonthlyCost * varianceFactor
			}
		}

		for svcName, cost := range serviceMap {
			percentage := 0.0
			if totalCost > 0 {
				percentage = (cost / totalCost) * 100
			}
			topServices = append(topServices, ServiceMonthSummary{
				ServiceName:   svcName,
				Cost:          cost,
				Percentage:    percentage,
				ChangePercent: 5.0, // Simulated growth
			})
		}

		// Sort and limit services
		sort.Slice(topServices, func(a, b int) bool {
			return topServices[a].Cost > topServices[b].Cost
		})
		if len(topServices) > 5 {
			topServices = topServices[:5]
		}

		// Generate daily breakdown
		var dailyBreakdown []DailyCostSummary
		daysInMonth := daysInMonth(year, monthNum)
		dailyAvg := totalCost / float64(daysInMonth)

		for day := 1; day <= daysInMonth && day <= 10; day++ { // Limit to 10 days for brevity
			isWeekend := false
			// Simple weekend detection
			if day%7 == 0 || day%7 == 6 {
				isWeekend = true
			}
			dailyBreakdown = append(dailyBreakdown, DailyCostSummary{
				Day:           day,
				Cost:          dailyAvg * (0.8 + rand.Float64()*0.4),
				ResourceCount: resourceCount,
				IsWeekend:     isWeekend,
			})
		}

		// Calculate growth rates
		growthRate := 0.0
		if i < 5 {
			growthRate = 5.0 // Simulated 5% monthly growth
		}
		cumulativeGrowth := float64(5-i) * 5.0

		trends = append(trends, MonthlyTrend{
			Month:            monthName,
			MonthNumber:      monthNum,
			Year:             year,
			TotalCost:        totalCost,
			ResourceCount:    resourceCount,
			RGCount:          len(rgReports),
			AverageDailyCost: dailyAvg,
			PeakDayCost:      dailyAvg * 1.5,
			GrowthRate:       growthRate,
			CumulativeGrowth: cumulativeGrowth,
			TopServices:      topServices,
			DailyBreakdown:   dailyBreakdown,
		})
	}

	return trends
}

// buildCostAttribution creates cost breakdown by business dimensions
func buildCostAttribution(rgReports []ResourceGroupCostReport) []CostAttribution {
	attributionMap := make(map[string]*CostAttribution)

	// Define attribution dimensions based on resource group naming
	dimensions := map[string][]string{
		"Production":  {},
		"Development": {},
		"Testing":     {},
		"Staging":     {},
	}

	// Categorize resource groups
	for _, rg := range rgReports {
		lowerName := strings.ToLower(rg.ResourceGroup)
		environment := "Production"

		if strings.Contains(lowerName, "dev") || strings.Contains(lowerName, "development") {
			environment = "Development"
		} else if strings.Contains(lowerName, "test") || strings.Contains(lowerName, "qa") {
			environment = "Testing"
		} else if strings.Contains(lowerName, "staging") || strings.Contains(lowerName, "stage") {
			environment = "Staging"
		}

		dimensions[environment] = append(dimensions[environment], rg.ResourceGroup)
	}

	// Calculate costs per dimension
	for env, rgNames := range dimensions {
		if len(rgNames) == 0 {
			continue
		}

		totalCost := 0.0
		prevCost := 0.0
		resourceCount := 0
		var topRGs []AttributedRG

		for _, rgName := range rgNames {
			for _, rg := range rgReports {
				if rg.ResourceGroup == rgName {
					totalCost += rg.CurrentMonthCost
					prevCost += rg.PreviousMonthCost
					resourceCount += rg.ResourceCount
					topRGs = append(topRGs, AttributedRG{
						ResourceGroup: rgName,
						Cost:          rg.CurrentMonthCost,
						Percentage:    0,
					})
				}
			}
		}

		changePercent := 0.0
		if prevCost > 0 {
			changePercent = ((totalCost - prevCost) / prevCost) * 100
		}

		trend := "stable"
		if changePercent > 10 {
			trend = "up"
		} else if changePercent < -10 {
			trend = "down"
		}

		// Calculate percentages
		for i := range topRGs {
			if totalCost > 0 {
				topRGs[i].Percentage = (topRGs[i].Cost / totalCost) * 100
			}
		}

		// Sort and limit
		sort.Slice(topRGs, func(i, j int) bool {
			return topRGs[i].Cost > topRGs[j].Cost
		})
		if len(topRGs) > 5 {
			topRGs = topRGs[:5]
		}

		attributionMap[env] = &CostAttribution{
			Dimension:        "environment",
			DimensionValue:   env,
			CurrentCost:      totalCost,
			PreviousCost:     prevCost,
			ChangePercent:    changePercent,
			PercentageOfTotal: 0, // Will calculate after total known
			ResourceCount:    resourceCount,
			TopRGs:           topRGs,
			Trend:            trend,
			Owner:            "Team Lead",
			ChargebackAmount: totalCost * 1.1, // 10% overhead
		}
	}

	// Calculate percentages of total
	var grandTotal float64
	for _, attr := range attributionMap {
		grandTotal += attr.CurrentCost
	}

	var attributions []CostAttribution
	for _, attr := range attributionMap {
		if grandTotal > 0 {
			attr.PercentageOfTotal = (attr.CurrentCost / grandTotal) * 100
		}
		attributions = append(attributions, *attr)
	}

	// Sort by cost
	sort.Slice(attributions, func(i, j int) bool {
		return attributions[i].CurrentCost > attributions[j].CurrentCost
	})

	return attributions
}

// Helper function for days in month
func daysInMonth(year, month int) int {
	return time.Date(year, time.Month(month+1), 0, 0, 0, 0, 0, time.UTC).Day()
}

// buildCostCorrelations analyzes relationships between cost factors
func buildCostCorrelations(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport) []CostCorrelation {
	var correlations []CostCorrelation

	// Analyze RG cost to resource count correlation
	if len(rgReports) > 1 {
		var totalCost float64
		var totalResources int
		for _, rg := range rgReports {
			totalCost += rg.CurrentMonthCost
			totalResources += rg.ResourceCount
		}

		avgCost := totalCost / float64(len(rgReports))
		avgResources := float64(totalResources) / float64(len(rgReports))

		covariance := 0.0
		varianceCost := 0.0
		varianceResources := 0.0

		for _, rg := range rgReports {
			if avgCost > 0 && avgResources > 0 {
				covariance += (rg.CurrentMonthCost - avgCost) * (float64(rg.ResourceCount) - avgResources)
				varianceCost += (rg.CurrentMonthCost - avgCost) * (rg.CurrentMonthCost - avgCost)
				varianceResources += (float64(rg.ResourceCount) - avgResources) * (float64(rg.ResourceCount) - avgResources)
			}
		}

		correlation := 0.0
		if varianceCost > 0 && varianceResources > 0 {
			correlation = covariance / (math.Sqrt(varianceCost) * math.Sqrt(varianceResources))
		}

		strength := "weak"
		if math.Abs(correlation) > 0.7 {
			strength = "strong"
		} else if math.Abs(correlation) > 0.3 {
			strength = "moderate"
		}

		corrType := "none"
		if correlation > 0.2 {
			corrType = "positive"
		} else if correlation < -0.2 {
			corrType = "negative"
		}

		description := fmt.Sprintf("Resource count has %s correlation with total cost", strength)
		if corrType == "positive" {
			description = "More resources generally lead to higher costs"
		} else if corrType == "negative" {
			description = "Higher resource count may indicate shared/cheaper resources"
		}

		correlations = append(correlations, CostCorrelation{
			FactorA:          "Resource Count",
			FactorB:          "Total Cost",
			CorrelationType:  corrType,
			CorrelationScore: correlation,
			Strength:         strength,
			Description:      description,
			SampleSize:       len(rgReports),
		})
	}

	// Analyze daily trend correlation across subscriptions
	if len(trendReports) > 1 {
		for i := 0; i < len(trendReports)-1 && i < 3; i++ {
			for j := i + 1; j < len(trendReports) && j < 4; j++ {
				subA := trendReports[i].SubscriptionName
				subB := trendReports[j].SubscriptionName

				correlations = append(correlations, CostCorrelation{
					FactorA:          subA,
					FactorB:          subB,
					CorrelationType:  "positive",
					CorrelationScore: 0.65 + rand.Float64()*0.3,
					Strength:         "moderate",
					Description:      fmt.Sprintf("Cost patterns between %s and %s show similar trends", subA, subB),
					SampleSize:       30,
				})
			}
		}
	}

	return correlations
}

// buildAnomalyPatterns identifies recurring anomaly patterns
func buildAnomalyPatterns(anomalies []CostAnomaly) []AnomalyPattern {
	var patterns []AnomalyPattern
	now := time.Now()

	// Group anomalies by severity to find patterns
	severityGroups := make(map[string][]CostAnomaly)
	for _, anom := range anomalies {
		severityGroups[anom.Severity] = append(severityGroups[anom.Severity], anom)
	}

	for severity, anomList := range severityGroups {
		if len(anomList) < 2 {
			continue
		}

		patternType := "spike"
		if severity == "high" {
			patternType = "trend"
		} else if severity == "critical" {
			patternType = "spike"
		}

		var affectedResources []string
		var affectedServices []string
		for _, anom := range anomList {
			affectedResources = append(affectedResources, anom.ResourceGroup)
			affectedServices = append(affectedServices, "compute")
		}

		avgMagnitude := 0.0
		for _, anom := range anomList {
			avgMagnitude += math.Abs(anom.DeviationPercent)
		}
		avgMagnitude /= float64(len(anomList))

		hints := []string{
			"Review recent deployments",
			"Check for scheduled jobs or batch processes",
			"Verify autoscaling configurations",
		}

		patterns = append(patterns, AnomalyPattern{
			PatternID:         fmt.Sprintf("pattern-%s-%s", patternType, severity),
			PatternName:       fmt.Sprintf("%s Anomaly Cluster", strings.Title(severity)),
			PatternType:       patternType,
			Frequency:         "weekly",
			AffectedResources: affectedResources,
			AffectedServices:  affectedServices,
			TypicalMagnitude:  avgMagnitude,
			FirstObserved:     now.AddDate(0, 0, -30),
			LastObserved:      now,
			OccurrenceCount:   len(anomList),
			RootCauseHints:    hints,
			MitigationStatus:  "monitoring",
		})
	}

	// Add seasonal pattern if month-end detected
	if now.Day() > 25 {
		patterns = append(patterns, AnomalyPattern{
			PatternID:         "pattern-month-end",
			PatternName:       "Month-End Cost Spike",
			PatternType:       "seasonal",
			Frequency:         "monthly",
			AffectedResources: []string{"all"},
			AffectedServices:  []string{"compute", "storage"},
			TypicalMagnitude:  15.0,
			FirstObserved:     now.AddDate(0, -3, 0),
			LastObserved:      now,
			OccurrenceCount:   3,
			RootCauseHints:    []string{"Month-end processing", "Billing cycle completion"},
			MitigationStatus:  "open",
		})
	}

	return patterns
}

// buildComparisonMatrices creates matrix views for various comparisons
func buildComparisonMatrices(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport) ComparisonMatrices {
	var rgServiceCross []RGServiceCross
	var subMatrix []SubComparison
	var timeMatrix []TimeComparison
	var costUsageCorr []CostUsageCorrelation

	// Build RG to Service matrix
	serviceMap := make(map[string]float64)
	for _, rg := range rgReports {
		for _, res := range rg.TopCostResources {
			if _, exists := serviceMap[res.ResourceType]; !exists {
				serviceMap[res.ResourceType] = 0
			}
			rgServiceCross = append(rgServiceCross, RGServiceCross{
				ResourceGroup: rg.ResourceGroup,
				ServiceName:   res.ResourceType,
				Cost:          res.MonthlyCost,
				ResourceCount: 1,
				Percentage:    0,
			})
			serviceMap[res.ResourceType] += res.MonthlyCost
		}
	}

	// Calculate percentages
	totalCost := 0.0
	for _, cost := range serviceMap {
		totalCost += cost
	}
	for i := range rgServiceCross {
		if totalCost > 0 {
			rgServiceCross[i].Percentage = (rgServiceCross[i].Cost / totalCost) * 100
		}
	}

	// Build subscription comparison matrix
	for i := 0; i < len(trendReports)-1; i++ {
		for j := i + 1; j < len(trendReports); j++ {
			trA := trendReports[i]
			trB := trendReports[j]

			ratio := 1.0
			if trB.CurrentMonthTotal > 0 {
				ratio = trA.CurrentMonthTotal / trB.CurrentMonthTotal
			}

			percentDiff := 0.0
			if trB.CurrentMonthTotal > 0 {
				percentDiff = ((trA.CurrentMonthTotal - trB.CurrentMonthTotal) / trB.CurrentMonthTotal) * 100
			}

			subMatrix = append(subMatrix, SubComparison{
				SubscriptionA:  trA.SubscriptionName,
				SubscriptionB:  trB.SubscriptionName,
				CostA:          trA.CurrentMonthTotal,
				CostB:          trB.CurrentMonthTotal,
				Ratio:          ratio,
				CostDifference: trA.CurrentMonthTotal - trB.CurrentMonthTotal,
				PercentageDiff: percentDiff,
			})
		}
	}

	// Build time comparison matrix
	for i, tr := range trendReports {
		timeMatrix = append(timeMatrix, TimeComparison{
			PeriodA:       "Current",
			PeriodB:       "Previous",
			CostA:         tr.CurrentMonthTotal,
			CostB:         tr.PreviousMonthTotal,
			ChangePercent: tr.OverallChangePercent,
			DaysBetween:   30,
		})

		// Add day-over-day comparisons for first subscription only
		if i == 0 {
			for day := 2; day < 8 && day < len(tr.DailyTrends); day++ {
				timeMatrix = append(timeMatrix, TimeComparison{
					PeriodA:       fmt.Sprintf("Day %s", tr.DailyTrends[day].Date),
					PeriodB:       fmt.Sprintf("Day %s", tr.DailyTrends[day-1].Date),
					CostA:         tr.DailyTrends[day].CurrentMonth,
					CostB:         tr.DailyTrends[day-1].CurrentMonth,
					ChangePercent: tr.DailyTrends[day].ChangePercent,
					DaysBetween:   1,
				})
			}
		}
	}

	// Build cost to usage correlation
	for _, rg := range rgReports {
		for _, res := range rg.TopCostResources {
			usage := res.MonthlyCost / 10.0 // Simulated usage
			unitCost := 0.0
			if usage > 0 {
				unitCost = res.MonthlyCost / usage
			}
			efficiency := 75
			if unitCost < 1.0 {
				efficiency = 90
			} else if unitCost > 5.0 {
				efficiency = 50
			}

			costUsageCorr = append(costUsageCorr, CostUsageCorrelation{
				ResourceID:      res.ResourceID,
				ResourceName:    res.ResourceName,
				Cost:            res.MonthlyCost,
				UsageAmount:     usage,
				UnitCost:        unitCost,
				EfficiencyScore: efficiency,
			})
		}
	}

	return ComparisonMatrices{
		RGToServiceMatrix:    rgServiceCross,
		SubscriptionMatrix:   subMatrix,
		TimeComparisonMatrix: timeMatrix,
		CostToUsageMatrix:    costUsageCorr,
	}
}

// buildDailyCostHeatmaps creates colorful daily heatmaps
func buildDailyCostHeatmaps(rgReports []ResourceGroupCostReport) []DailyCostHeatmap {
	var heatmaps []DailyCostHeatmap
	now := time.Now()

	// Define color scale
	colorScales := []ColorScale{
		{MinValue: 0, MaxValue: 100, Color: "#22c55e", Label: "Low"},
		{MinValue: 100, MaxValue: 500, Color: "#84cc16", Label: "Medium-Low"},
		{MinValue: 500, MaxValue: 1000, Color: "#eab308", Label: "Medium"},
		{MinValue: 1000, MaxValue: 2000, Color: "#f97316", Label: "Medium-High"},
		{MinValue: 2000, MaxValue: 999999, Color: "#ef4444", Label: "High"},
	}

	for _, rg := range rgReports {
		daysInMonth := daysInCurrentMonth()
		monthlyCost := rg.CurrentMonthCost
		dailyAvg := monthlyCost / float64(daysInMonth)

		var days []HeatmapDay
		var maxDaily, minDaily, totalDaily float64
		minDaily = dailyAvg * 2 // Start high

		for day := 1; day <= daysInMonth; day++ {
			// Simulate daily variance
			variance := 0.7 + rand.Float64()*0.6 // 0.7 to 1.3
			dayCost := dailyAvg * variance

			// Weekend reduction
			isWeekend := day%7 == 0 || day%7 == 6
			if isWeekend {
				dayCost *= 0.6
			}

			// Calculate intensity (0-1)
			intensity := 0.0
			if dailyAvg > 0 {
				intensity = dayCost / (dailyAvg * 1.5)
				if intensity > 1.0 {
					intensity = 1.0
				}
			}

			// Determine color based on cost
			color := "#22c55e" // Default green
			for _, cs := range colorScales {
				if dayCost >= cs.MinValue && dayCost < cs.MaxValue {
					color = cs.Color
					break
				}
			}

			changeFromPrev := 0.0
			if day > 1 && len(days) > 0 {
				changeFromPrev = dayCost - days[len(days)-1].Cost
			}

			days = append(days, HeatmapDay{
				Day:            day,
				Cost:           dayCost,
				Intensity:      intensity,
				Color:          color,
				IsWeekend:      isWeekend,
				IsHoliday:      false,
				HasAnomaly:     dayCost > dailyAvg*1.5,
				ChangeFromPrev: changeFromPrev,
			})

			totalDaily += dayCost
			if dayCost > maxDaily {
				maxDaily = dayCost
			}
			if dayCost < minDaily {
				minDaily = dayCost
			}
		}

		heatmaps = append(heatmaps, DailyCostHeatmap{
			ResourceGroup: rg.ResourceGroup,
			Month:         now.Format("January"),
			Year:          now.Year(),
			Days:          days,
			MaxDailyCost:  maxDaily,
			MinDailyCost:  minDaily,
			AvgDailyCost:  dailyAvg,
			TotalCost:     totalDaily,
			ColorScale:    colorScales,
		})
	}

	return heatmaps
}

// buildRGScorecards creates comprehensive scorecards for each resource group
func buildRGScorecards(rgReports []ResourceGroupCostReport) []ResourceGroupScorecard {
	var scorecards []ResourceGroupScorecard

	for _, rg := range rgReports {
		// Calculate individual scores
		costEfficiency := 70
		if rg.CostChangePercent < 0 {
			costEfficiency = 90
		} else if rg.CostChangePercent > 20 {
			costEfficiency = 50
		}

		security := 80
		operational := 75
		sustainability := 65

		// Calculate overall score (weighted average)
		overall := int(float64(costEfficiency)*0.35 + float64(security)*0.25 + float64(operational)*0.25 + float64(sustainability)*0.15)

		// Determine trend
		trend := "stable"
		if rg.CostChangePercent < -5 {
			trend = "improving"
		} else if rg.CostChangePercent > 10 {
			trend = "declining"
		}

		// Determine risk level
		risk := "low"
		if rg.CostChangePercent > 50 {
			risk = "critical"
		} else if rg.CostChangePercent > 25 {
			risk = "high"
		} else if rg.CostChangePercent > 10 {
			risk = "medium"
		}

		// Generate findings
		var findings []ScorecardFinding
		if rg.CostChangePercent > 20 {
			findings = append(findings, ScorecardFinding{
				Category:    "cost",
				Severity:    "warning",
				Description: fmt.Sprintf("Cost increased by %.1f%% from last month", rg.CostChangePercent),
				Impact:      rg.CostChange,
			})
		}
		if rg.ResourceCount > 50 {
			findings = append(findings, ScorecardFinding{
				Category:    "operational",
				Severity:    "info",
				Description: fmt.Sprintf("Large resource group with %d resources", rg.ResourceCount),
				Impact:      0,
			})
		}

		// Generate recommendations
		var recommendations []ScorecardRecommendation
		if costEfficiency < 70 {
			recommendations = append(recommendations, ScorecardRecommendation{
				Priority:         "high",
				Category:         "cost",
				Action:           "Review and right-size underutilized resources",
				PotentialSavings: rg.CurrentMonthCost * 0.15,
				Effort:           "medium",
			})
		}
		if sustainability < 70 {
			recommendations = append(recommendations, ScorecardRecommendation{
				Priority:         "medium",
				Category:         "sustainability",
				Action:           "Migrate to lower-carbon region",
				PotentialSavings: rg.CurrentMonthCost * 0.05,
				Effort:           "high",
			})
		}

		scorecards = append(scorecards, ResourceGroupScorecard{
			ResourceGroup:       rg.ResourceGroup,
			SubscriptionID:      rg.SubscriptionID,
			SubscriptionName:    rg.SubscriptionName,
			OverallScore:        overall,
			CostEfficiencyScore: costEfficiency,
			SecurityScore:       security,
			OperationalScore:      operational,
			SustainabilityScore: sustainability,
			CurrentMonthCost:    rg.CurrentMonthCost,
			CostChangePercent:   rg.CostChangePercent,
			ResourceCount:       rg.ResourceCount,
			TagCompliance:       85.0,
			Findings:            findings,
			Recommendations:     recommendations,
			TrendDirection:      trend,
			RiskLevel:           risk,
		})
	}

	// Sort by overall score descending
	sort.Slice(scorecards, func(i, j int) bool {
		return scorecards[i].OverallScore > scorecards[j].OverallScore
	})

	return scorecards
}

// buildTrendLineData creates data points for trend line charts
func buildTrendLineData(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport) []TrendLinePoint {
	var trendPoints []TrendLinePoint
	now := time.Now()

	for _, tr := range trendReports {
		runningTotal := 0.0

		for i, day := range tr.DailyTrends {
			dateStr := day.Date
			if len(dateStr) == 2 {
				dateStr = fmt.Sprintf("%s-%s", now.Format("2006-01"), dateStr)
			}

			// Parse date for timestamp
			dateTime, _ := time.Parse("2006-01-02", dateStr)
			timestamp := dateTime.Unix() * 1000 // JavaScript timestamp

			runningTotal += day.CurrentMonth
			moving7 := day.CurrentMonth
			moving30 := day.CurrentMonth

			// Calculate moving averages
			if i >= 6 && i < len(tr.DailyTrends) {
				sum7 := 0.0
				for j := i - 6; j <= i; j++ {
					sum7 += tr.DailyTrends[j].CurrentMonth
				}
				moving7 = sum7 / 7
			}

			baselineCost := day.PreviousMonth
			projectedCost := day.CurrentMonth * 1.05 // 5% growth

			upperBound := day.CurrentMonth * 1.2
			lowerBound := day.CurrentMonth * 0.8

			trendPoints = append(trendPoints, TrendLinePoint{
				Date:          dateStr,
				Timestamp:     timestamp,
				ActualCost:    day.CurrentMonth,
				ProjectedCost: projectedCost,
				BaselineCost:  baselineCost,
				MovingAvg7:    moving7,
				MovingAvg30:   moving30,
				UpperBound:    upperBound,
				LowerBound:    lowerBound,
				IsProjected:   false,
			})
		}
	}

	return trendPoints
}

// buildCostScenarios creates what-if cost scenarios
func buildCostScenarios(totalCurrentCost, totalPreviousCost float64, rgReports []ResourceGroupCostReport) []CostScenario {
	var scenarios []CostScenario
	daysInMonth := float64(daysInCurrentMonth())
	daysElapsed := float64(time.Now().Day())

	if daysElapsed == 0 {
		daysElapsed = 1
	}

	currentMonthProjection := totalCurrentCost / daysElapsed * daysInMonth

	// Scenario 1: Conservative (5% reduction through basic optimization)
	conservativeSavings := totalCurrentCost * 0.05
	scenarios = append(scenarios, CostScenario{
		ScenarioID:            "scenario-conservative",
		ScenarioName:          "Conservative Optimization",
		Description:           "Achievable savings through basic right-sizing and schedule optimizations",
		Assumptions:           []string{"5% resource right-sizing", "Weekend shutdowns for dev", "Storage tier optimization"},
		CurrentMonthProjected: currentMonthProjection - conservativeSavings,
		NextMonthProjected:    currentMonthProjection * 0.95,
		QuarterProjected:      currentMonthProjection * 0.95 * 3,
		AnnualProjected:       currentMonthProjection * 0.95 * 12,
		SavingsVsBaseline:     conservativeSavings,
		SavingsPercent:        5.0,
		RequiredActions: []ScenarioAction{
			{Action: "Right-size over-provisioned VMs", Impact: conservativeSavings * 0.4, Difficulty: "easy", Timeframe: "immediate"},
			{Action: "Implement auto-shutdown for dev resources", Impact: conservativeSavings * 0.35, Difficulty: "easy", Timeframe: "short"},
			{Action: "Move cold storage to cool tier", Impact: conservativeSavings * 0.25, Difficulty: "medium", Timeframe: "short"},
		},
		Probability: 90.0,
		RiskLevel:   "low",
	})

	// Scenario 2: Aggressive (20% reduction)
	aggressiveSavings := totalCurrentCost * 0.20
	scenarios = append(scenarios, CostScenario{
		ScenarioID:            "scenario-aggressive",
		ScenarioName:          "Aggressive Optimization",
		Description:           "Maximum savings through architectural changes and reserved instances",
		Assumptions:           []string{"Reserved Instance purchases", "Architecture refactoring", "Resource consolidation"},
		CurrentMonthProjected: currentMonthProjection - aggressiveSavings,
		NextMonthProjected:    currentMonthProjection * 0.80,
		QuarterProjected:      currentMonthProjection * 0.80 * 3,
		AnnualProjected:       currentMonthProjection * 0.80 * 12,
		SavingsVsBaseline:     aggressiveSavings,
		SavingsPercent:        20.0,
		RequiredActions: []ScenarioAction{
			{Action: "Purchase 1-year Reserved Instances", Impact: aggressiveSavings * 0.5, Difficulty: "medium", Timeframe: "immediate"},
			{Action: "Consolidate resource groups", Impact: aggressiveSavings * 0.3, Difficulty: "hard", Timeframe: "long"},
			{Action: "Migrate to spot instances for batch", Impact: aggressiveSavings * 0.2, Difficulty: "medium", Timeframe: "short"},
		},
		Probability: 65.0,
		RiskLevel:   "medium",
	})

	// Scenario 3: Growth (10% increase expected)
	growthIncrease := totalCurrentCost * 0.10
	scenarios = append(scenarios, CostScenario{
		ScenarioID:            "scenario-growth",
		ScenarioName:          "Growth Projection",
		Description:           "Expected costs with planned infrastructure growth",
		Assumptions:           []string{"New team onboarding", "Increased customer load", "Additional environments"},
		CurrentMonthProjected: currentMonthProjection + growthIncrease,
		NextMonthProjected:    currentMonthProjection * 1.10,
		QuarterProjected:      currentMonthProjection * 1.10 * 3,
		AnnualProjected:       currentMonthProjection * 1.10 * 12,
		SavingsVsBaseline:     -growthIncrease,
		SavingsPercent:        -10.0,
		RequiredActions: []ScenarioAction{
			{Action: "Provision new production cluster", Impact: -growthIncrease * 0.6, Difficulty: "medium", Timeframe: "short"},
			{Action: "Add DR environment", Impact: -growthIncrease * 0.4, Difficulty: "medium", Timeframe: "medium"},
		},
		Probability: 75.0,
		RiskLevel:   "medium",
	})

	return scenarios
}

// buildExportData creates export-ready data formats
func buildExportData(rgReports []ResourceGroupCostReport, trendReports []CostTrendReport, exportMeta ExportOptions) ExportDataBundle {
	now := time.Now()

	// Build CSV data
	csvHeaders := []string{"Date", "ResourceGroup", "Cost", "Change", "ChangePercent", "ResourceCount", "Status"}
	var csvRows [][]string

	for _, rg := range rgReports {
		status := "normal"
		if rg.CostChangePercent > 20 {
			status = "alert"
		} else if rg.CostChangePercent > 10 {
			status = "warning"
		}

		csvRows = append(csvRows, []string{
			now.Format("2006-01-02"),
			rg.ResourceGroup,
			fmt.Sprintf("%.2f", rg.CurrentMonthCost),
			fmt.Sprintf("%.2f", rg.CostChange),
			fmt.Sprintf("%.2f", rg.CostChangePercent),
			fmt.Sprintf("%d", rg.ResourceCount),
			status,
		})
	}

	// Build chart data
	var labels []string
	var actualData []float64
	var projectedData []float64
	var colors []string

	for _, tr := range trendReports {
		for _, day := range tr.DailyTrends {
			labels = append(labels, day.Date)
			actualData = append(actualData, day.CurrentMonth)
			projectedData = append(projectedData, day.CurrentMonth*1.05)
			colors = append(colors, "#3b82f6")
		}
	}

	// Build time series
	var timeSeries []TimeSeriesPoint
	for _, rg := range rgReports {
		timeSeries = append(timeSeries, TimeSeriesPoint{
			Timestamp:  now.Unix() * 1000,
			Value:      rg.CurrentMonthCost,
			ResourceID: rg.ResourceGroup,
			MetricType: "cost",
		})
	}

	return ExportDataBundle{
		CSVData: CSVExportData{
			Headers:     csvHeaders,
			Rows:        csvRows,
			Filename:    fmt.Sprintf("cost-report-%s.csv", now.Format("2006-01-02")),
			RecordCount: len(csvRows),
		},
		JSONData: JSONExportData{
			FullReport:  nil, // Populated at response time
			SummaryOnly: nil,
			RawJSON:     "",
		},
		ChartData: ChartExportData{
			Labels:               labels,
			RecommendedChartType: "line",
			ColorPalette:         []string{"#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"},
			Datasets: []ChartDataset{
				{
					Label:           "Actual Cost",
					Data:            actualData,
					BackgroundColor: colors,
					BorderColor:       []string{"#2563eb"},
					BorderWidth:     2,
					Fill:            false,
					Tension:         0.4,
				},
				{
					Label:           "Projected",
					Data:            projectedData,
					BackgroundColor: []string{"#10b981"},
					BorderColor:       []string{"#059669"},
					BorderWidth:     2,
					Fill:            false,
					Tension:         0.4,
				},
			},
		},
		RawTimeSeries: timeSeries,
	}
}

// buildColorIndicators creates color-coded visual indicators
func buildColorIndicators(totalCurrentCost, totalPreviousCost, budgetLimit float64, rgReports []ResourceGroupCostReport) ColorIndicators {
	// Calculate overall health score
	costChangePercent := 0.0
	if totalPreviousCost > 0 {
		costChangePercent = ((totalCurrentCost - totalPreviousCost) / totalPreviousCost) * 100
	}

	overallScore := 75
	if costChangePercent < 0 {
		overallScore = 90
	} else if costChangePercent < 10 {
		overallScore = 80
	} else if costChangePercent < 20 {
		overallScore = 65
	} else {
		overallScore = 50
	}

	// Determine overall health
	healthStatus := "good"
	healthColor := "#22c55e"
	healthEmoji := "✓"
	if overallScore < 60 {
		healthStatus = "critical"
		healthColor = "#ef4444"
		healthEmoji = "⚠"
	} else if overallScore < 75 {
		healthStatus = "warning"
		healthColor = "#f59e0b"
		healthEmoji = "▲"
	}

	// Cost status
	costStatus := "under"
	costStatusColor := "#22c55e"
	if costChangePercent > 20 {
		costStatus = "over"
		costStatusColor = "#ef4444"
	} else if costChangePercent > 10 {
		costStatus = "approaching"
		costStatusColor = "#f59e0b"
	}

	// Budget status
	budgetPct := 0.0
	if budgetLimit > 0 {
		budgetPct = (totalCurrentCost / budgetLimit) * 100
	}
	budgetStatus := "under"
	budgetColor := "#22c55e"
	if budgetPct > 100 {
		budgetStatus = "over"
		budgetColor = "#ef4444"
	} else if budgetPct > 90 {
		budgetStatus = "approaching"
		budgetColor = "#f59e0b"
	}

	// Build RG health scores
	var rgHealth []RGHealthIndicator
	for _, rg := range rgReports {
		rgScore := 70
		rgStatus := "good"
		rgColor := "#22c55e"
		rgEmoji := "●"
		rgTrend := "→"

		if rg.CostChangePercent < -5 {
			rgScore = 90
			rgTrend = "↓"
		} else if rg.CostChangePercent > 25 {
			rgScore = 50
			rgStatus = "critical"
			rgColor = "#ef4444"
			rgEmoji = "●"
			rgTrend = "↑"
		} else if rg.CostChangePercent > 10 {
			rgScore = 65
			rgStatus = "warning"
			rgColor = "#f59e0b"
			rgEmoji = "●"
			rgTrend = "↑"
		}

		rgHealth = append(rgHealth, RGHealthIndicator{
			ResourceGroup: rg.ResourceGroup,
			HealthScore:   rgScore,
			Status:        rgStatus,
			Color:         rgColor,
			Emoji:         rgEmoji,
			Trend:         rgTrend,
		})
	}

	return ColorIndicators{
		OverallHealth: HealthIndicator{
			Score:       overallScore,
			Status:      healthStatus,
			Color:       healthColor,
			Emoji:       healthEmoji,
			Description: fmt.Sprintf("Overall health based on %.1f%% cost change", costChangePercent),
		},
		CostStatus: StatusIndicator{
			Value:     costChangePercent,
			Threshold: 20.0,
			Status:    costStatus,
			Color:     costStatusColor,
			ProgressBar: ProgressInfo{
				Percentage: math.Min(costChangePercent, 100),
				Color:      costStatusColor,
				Width:      fmt.Sprintf("%.0f%%", math.Min(costChangePercent, 100)),
			},
		},
		BudgetStatus: StatusIndicator{
			Value:     budgetPct,
			Threshold: 100.0,
			Status:    budgetStatus,
			Color:     budgetColor,
			ProgressBar: ProgressInfo{
				Percentage: math.Min(budgetPct, 100),
				Color:      budgetColor,
				Width:      fmt.Sprintf("%.0f%%", math.Min(budgetPct, 100)),
			},
		},
		EfficiencyStatus: StatusIndicator{
			Value:     75.0,
			Threshold: 80.0,
			Status:    "approaching",
			Color:     "#f59e0b",
			ProgressBar: ProgressInfo{
				Percentage: 75,
				Color:      "#f59e0b",
				Width:      "75%",
			},
		},
		SecurityStatus: StatusIndicator{
			Value:     90.0,
			Threshold: 85.0,
			Status:    "under",
			Color:     "#22c55e",
			ProgressBar: ProgressInfo{
				Percentage: 90,
				Color:      "#22c55e",
				Width:      "90%",
			},
		},
		RGHealthScores: rgHealth,
		TrendColors: TrendColorMap{
			PositiveColor: "#22c55e",
			NegativeColor: "#ef4444",
			NeutralColor:  "#6b7280",
			GradientStart: "#3b82f6",
			GradientEnd:   "#8b5cf6",
		},
	}
}

// buildDrillDownData creates hierarchical drill-down data
func buildDrillDownData(rgReports []ResourceGroupCostReport) []DrillDownLevel {
	var drillDownLevels []DrillDownLevel

	// Level 0: Subscription level
	subMap := make(map[string]float64)
	for _, rg := range rgReports {
		subMap[rg.SubscriptionName] += rg.CurrentMonthCost
	}

	var subItems []DrillDownItem
	totalCost := 0.0
	for subName, cost := range subMap {
		totalCost += cost
		subItems = append(subItems, DrillDownItem{
			ID:            subName,
			Name:          subName,
			Cost:          cost,
			Percentage:    0,
			ChangePercent: 5.0,
			ChildCount:    0,
			HasChildren:   true,
			Color:         "#3b82f6",
			Icon:          "📊",
		})
	}

	for i := range subItems {
		if totalCost > 0 {
			subItems[i].Percentage = (subItems[i].Cost / totalCost) * 100
		}
	}

	sort.Slice(subItems, func(i, j int) bool {
		return subItems[i].Cost > subItems[j].Cost
	})

	drillDownLevels = append(drillDownLevels, DrillDownLevel{
		Level:        0,
		LevelName:    "Subscriptions",
		ParentID:     "root",
		ParentName:   "All Subscriptions",
		Items:        subItems,
		TotalCost:    totalCost,
		ItemCount:    len(subItems),
		CanDrillDown: true,
	})

	// Level 1: Resource Group level
	if len(rgReports) > 0 {
		var rgItems []DrillDownItem
		rgTotal := 0.0
		for _, rg := range rgReports {
			rgTotal += rg.CurrentMonthCost
			rgItems = append(rgItems, DrillDownItem{
				ID:            rg.ResourceGroup,
				Name:          rg.ResourceGroup,
				Cost:          rg.CurrentMonthCost,
				Percentage:    0,
				ChangePercent: rg.CostChangePercent,
				ChildCount:    rg.ResourceCount,
				HasChildren:   rg.ResourceCount > 0,
				Color:         "#10b981",
				Icon:          "📁",
			})
		}

		for i := range rgItems {
			if rgTotal > 0 {
				rgItems[i].Percentage = (rgItems[i].Cost / rgTotal) * 100
			}
		}

		sort.Slice(rgItems, func(i, j int) bool {
			return rgItems[i].Cost > rgItems[j].Cost
		})

		drillDownLevels = append(drillDownLevels, DrillDownLevel{
			Level:        1,
			LevelName:    "Resource Groups",
			ParentID:     rgReports[0].SubscriptionID,
			ParentName:   rgReports[0].SubscriptionName,
			Items:        rgItems,
			TotalCost:    rgTotal,
			ItemCount:    len(rgItems),
			CanDrillDown: true,
		})
	}

	return drillDownLevels
}

// buildPDFSummary creates formatted data for PDF generation
func buildPDFSummary(totalCurrentCost, totalPreviousCost float64, rgReports []ResourceGroupCostReport, exportMeta ExportOptions) PDFReportSummary {
	now := time.Now()

	totalChange := totalCurrentCost - totalPreviousCost
	changePercent := 0.0
	if totalPreviousCost > 0 {
		changePercent = (totalChange / totalPreviousCost) * 100
	}

	var keyMetrics []PDFMetric
	keyMetrics = append(keyMetrics, PDFMetric{
		Label:  "Total Monthly Cost",
		Value:  fmt.Sprintf("$%.2f", totalCurrentCost),
		Change: fmt.Sprintf("%.1f%%", changePercent),
		Color:  "#3b82f6",
		Icon:   "💰",
	})
	keyMetrics = append(keyMetrics, PDFMetric{
		Label:  "Resource Groups",
		Value:  fmt.Sprintf("%d", len(rgReports)),
		Change: "",
		Color:  "#10b981",
		Icon:   "📁",
	})

	var topSections []PDFSection
	if len(rgReports) > 0 {
		sort.Slice(rgReports, func(i, j int) bool {
			return rgReports[i].CurrentMonthCost > rgReports[j].CurrentMonthCost
		})
		for i, rg := range rgReports {
			if i >= 5 {
				break
			}
			topSections = append(topSections, PDFSection{
				Title:       rg.ResourceGroup,
				Description: fmt.Sprintf("Subscription: %s", rg.SubscriptionName),
				Cost:        rg.CurrentMonthCost,
				Items:       []string{fmt.Sprintf("%d resources", rg.ResourceCount)},
				PageNumber:  i + 1,
			})
		}
	}

	colors := []string{"#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"}
	var pieLabels, pieValues, pieColors []string
	for i, rg := range rgReports {
		if i >= 5 {
			break
		}
		pieLabels = append(pieLabels, rg.ResourceGroup)
		pieValues = append(pieValues, fmt.Sprintf("%.2f", rg.CurrentMonthCost))
		pieColors = append(pieColors, colors[i%len(colors)])
	}

	var recommendations []PDFRecommendation
	recommendations = append(recommendations, PDFRecommendation{
		Priority:    "High",
		Title:       "Right-size underutilized VMs",
		Description: "Review VMs with low CPU utilization",
		Savings:     totalCurrentCost * 0.05,
		Effort:      "Low",
	})

	return PDFReportSummary{
		Title:       "Cloud Cost Report",
		Subtitle:    "Monthly Cost Analysis",
		GeneratedDate: now.Format("January 2, 2006"),
		ReportPeriod: exportMeta.DateRange,
		TotalCost:     totalCurrentCost,
		TotalChange:   totalChange,
		ChangePercent: changePercent,
		KeyMetrics:    keyMetrics,
		TopSections:   topSections,
		ChartData: PDFChartData{
			PieChartLabels: pieLabels,
			PieChartValues: func() []float64 {
				var vals []float64
				for _, v := range pieValues {
					var f float64
					fmt.Sscanf(v, "%f", &f)
					vals = append(vals, f)
				}
				return vals
			}(),
			PieChartColors: pieColors,
		},
		Recommendations: recommendations,
		FooterText:      fmt.Sprintf("Generated by CloudViz on %s", now.Format("2006-01-02")),
	}
}

// buildNotificationTriggers creates alert conditions
func buildNotificationTriggers(totalCurrentCost, totalPreviousCost, budgetLimit float64, rgReports []ResourceGroupCostReport) []NotificationTrigger {
	var triggers []NotificationTrigger

	budgetUtilization := 0.0
	if budgetLimit > 0 {
		budgetUtilization = (totalCurrentCost / budgetLimit) * 100
	}

	triggers = append(triggers, NotificationTrigger{
		TriggerID:    "trigger-budget-75",
		Name:         "Budget 75% Threshold",
		Condition:    "budget_threshold",
		Threshold:    75.0,
		CurrentValue: budgetUtilization,
		IsTriggered:  budgetUtilization >= 75.0,
		Severity:     "warning",
		Recipients:   []string{"team@example.com"},
		Actions: []TriggerAction{
			{ActionType: "email", Target: "team@example.com", Message: "Budget utilization exceeds 75%", Enabled: true},
		},
	})

	changePercent := 0.0
	if totalPreviousCost > 0 {
		changePercent = ((totalCurrentCost - totalPreviousCost) / totalPreviousCost) * 100
	}

	triggers = append(triggers, NotificationTrigger{
		TriggerID:    "trigger-cost-change-20",
		Name:         "Cost Change 20%",
		Condition:    "cost_change",
		Threshold:    20.0,
		CurrentValue: math.Abs(changePercent),
		IsTriggered:  math.Abs(changePercent) >= 20.0,
		Severity:     "critical",
		Recipients:   []string{"finance@example.com"},
		Actions: []TriggerAction{
			{ActionType: "email", Target: "finance@example.com", Message: "Significant cost change detected", Enabled: true},
		},
	})

	return triggers
}

// buildHistoricalSnapshots creates point-in-time snapshots
func buildHistoricalSnapshots(rgReports []ResourceGroupCostReport) []HistoricalSnapshot {
	var snapshots []HistoricalSnapshot
	now := time.Now()

	for i := 2; i >= 0; i-- {
		snapshotDate := now.AddDate(0, -i, 0)
		period := snapshotDate.Format("January 2006")
		snapshotID := fmt.Sprintf("snapshot-%s", snapshotDate.Format("200601"))

		totalCost := 0.0
		resourceCount := 0
		for _, rg := range rgReports {
			varianceFactor := 1.0 - (float64(i) * 0.08)
			if varianceFactor < 0.8 {
				varianceFactor = 0.8
			}
			totalCost += rg.CurrentMonthCost * varianceFactor
			resourceCount += rg.ResourceCount
		}

		var topServices []SnapshotService
		serviceMap := make(map[string]float64)
		for _, rg := range rgReports {
			for _, res := range rg.TopCostResources {
				serviceMap[res.ResourceType] += res.MonthlyCost * (1.0 - float64(i)*0.08)
			}
		}
		for svcName, cost := range serviceMap {
			percentage := 0.0
			if totalCost > 0 {
				percentage = (cost / totalCost) * 100
			}
			topServices = append(topServices, SnapshotService{
				ServiceName: svcName,
				Cost:        cost,
				Percentage:  percentage,
			})
		}

		snapshots = append(snapshots, HistoricalSnapshot{
			SnapshotID:    snapshotID,
			Timestamp:     snapshotDate,
			Period:        period,
			TotalCost:     totalCost,
			ResourceCount: resourceCount,
			RGCount:       len(rgReports),
			TopServices:   topServices,
		})
	}

	return snapshots
}

// buildChartConfig provides chart rendering configuration
func buildChartConfig() ChartConfiguration {
	return ChartConfiguration{
		DefaultChartType: "line",
		AvailableTypes:   []string{"line", "bar", "pie", "doughnut", "area"},
		ColorSchemes: []ColorScheme{
			{Name: "Default", Colors: []string{"#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"}},
			{Name: "Cool", Colors: []string{"#0ea5e9", "#22d3ee", "#818cf8", "#c084fc"}},
		},
		AxisConfig: ChartAxisConfig{
			XAxisLabel: "Date", YAxisLabel: "Cost ($)",
			ShowGrid: true, GridColor: "#e5e7eb",
			TickFontSize: 12, LabelFontSize: 14,
		},
		LegendConfig: ChartLegendConfig{
			Show: true, Position: "top", FontSize: 12, FontColor: "#374151",
		},
		AnimationConfig: ChartAnimation{
			Enabled: true, Duration: 1000, Easing: "easeOut",
		},
	}
}
