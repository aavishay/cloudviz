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
	costLimiter    = rate.NewLimiter(rate.Limit(0.5), 1)
)

// toAnySlice converts a string slice to []any for SQL query arguments
func toAnySlice(ss []string) []any {
	result := make([]any, len(ss))
	for i, s := range ss {
		result[i] = s
	}
	return result
}

func main() {
	var rootCmd = &cobra.Command{
		Use:     "cloudviz",
		Short:   "CloudViz is an Azure resource and cost management tool",
		Version: "1.8.1",
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

			res, err := fetchSubCostsSync(costClient, subID, "current", start, context.Background())
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
		recordResourceChanges(cache.db, res)
		c.JSON(200, gin.H{"data": res, "totalCost": totalCost, "total": len(res)})
	})

	r.GET("/api/filters", func(c *gin.Context) {
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		subs, rgs, types, locs := make(map[string]bool), make(map[string]bool), make(map[string]bool), make(map[string]bool)
		for _, r := range res {
			subs[r.SubscriptionID] = true
			rgs[r.ResourceGroup] = true
			types[r.Type] = true
			locs[r.Location] = true
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

		c.JSON(200, gin.H{
			"subs":      keys(subs),
			"rgs":       keys(rgs),
			"types":     keys(types),
			"locations": keys(locs),
		})
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

	// Cost anomaly detection endpoint
	r.GET("/api/costs/anomalies", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		threshold := 2.0 // ratio threshold: flag if cost is threshold-x or more of previous period
		zThreshold := 2.0 // z-score threshold: flag if cost is zThreshold std deviations above mean
		if t := c.Query("threshold"); t != "" {
			fmt.Sscanf(t, "%f", &threshold)
		}
		if z := c.Query("zscore"); z != "" {
			fmt.Sscanf(z, "%f", &zThreshold)
		}

		now := time.Now()
		currentStart := now.AddDate(0, 0, -30)
		previousStart := now.AddDate(0, 0, -60)
		previousEnd := now.AddDate(0, 0, -30)

		var anomalies []map[string]any
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

				current, err1 := fetchDailyCosts(costClient, subID, currentStart, now, c.Request.Context())
				previous, err2 := fetchDailyCosts(costClient, subID, previousStart, previousEnd, c.Request.Context())

				if err1 != nil || err2 != nil {
					return
				}

				// Build daily maps
				currentMap := make(map[string]float64)
				for _, d := range current {
					if date, ok := d["date"].(string); ok {
						currentMap[date] = d["cost"].(float64)
					}
				}
				previousMap := make(map[string]float64)
				for _, d := range previous {
					if date, ok := d["date"].(string); ok {
						previousMap[date] = d["cost"].(float64)
					}
				}

				// Compute current period mean and stddev for z-score
				var currentVals []float64
				for _, v := range currentMap {
					currentVals = append(currentVals, v)
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

				// Compare each day in current period vs same day last period (ratio-based)
				for date, currCost := range currentMap {
					prevCost, exists := previousMap[date]
					if !exists || prevCost == 0 {
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
			"anomalies":   anomalies,
			"threshold":   threshold,
			"zThreshold":  zThreshold,
			"periodStart": currentStart.Format("2006-01-02"),
			"periodEnd":   now.Format("2006-01-02"),
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

	// Waste detection: always-on resources in non-production environments
	r.GET("/api/waste/detect", func(c *gin.Context) {
		res, _, err := FetchResourcesWithCosts(c.Request.Context(), nil, nil, nil, nil, "", false, false, false, false, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		var waste []map[string]any
		for _, r := range res {
			if !strings.Contains(strings.ToLower(r.Type), "virtualmachine") {
				continue
			}

			// Infer environment from RG name
			rgLow := strings.ToLower(r.ResourceGroup)
			env := ""
			if strings.Contains(rgLow, "prod") || strings.Contains(rgLow, "production") {
				env = "production"
			} else if strings.Contains(rgLow, "dev") || strings.Contains(rgLow, "development") {
				env = "development"
			} else if strings.Contains(rgLow, "stag") || strings.Contains(rgLow, "staging") {
				env = "staging"
			} else if strings.Contains(rgLow, "test") || strings.Contains(rgLow, "qa") {
				env = "test"
			}

			if env == "" || env == "production" {
				continue // skip production and unclassified
			}

			// Check if name contains non-dev keywords (could be accidentally running prod workloads)
			nameLow := strings.ToLower(r.Name)
			isActuallyDev := strings.Contains(nameLow, "dev") || strings.Contains(nameLow, "test") || strings.Contains(nameLow, "sandbox") || strings.Contains(nameLow, "lab")

			if !isActuallyDev && r.Cost > 0 {
				// This is a likely waste: non-dev-named VM in a non-prod RG
				estimatedWaste := r.Cost
				if r.Score >= 80 {
					estimatedWaste = r.Cost * 0.5 // if it has good score, less waste
				}
				waste = append(waste, map[string]any{
					"resourceId":   r.ID,
					"name":        r.Name,
					"resourceGroup": r.ResourceGroup,
					"subscriptionId": r.SubscriptionID,
					"type":        r.Type,
					"environment":  env,
					"monthlyCost": r.Cost,
					"wasteType":   "non-dev in " + env,
					"suggestion":  "Verify if this workload should run 24/7 or be stopped during off-hours",
					"potentialSavings": estimatedWaste,
				})
			}
		}

		sort.Slice(waste, func(i, j int) bool {
			return waste[i]["potentialSavings"].(float64) > waste[j]["potentialSavings"].(float64)
		})

		var totalWaste float64
		for _, w := range waste {
			totalWaste += w["potentialSavings"].(float64)
		}

		c.JSON(200, map[string]any{
			"items":      waste,
			"totalCount": len(waste),
			"totalWaste": totalWaste,
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
						actual, forecast, err := fetchForecast(forecastClient, subID, start, now, context.Background())
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

		c.Data(200, contentType, data)
	})

	fmt.Printf("CloudViz server starting at :%s\n", port)
	go backgroundSync(costClient)
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
	rows, err := cache.db.Query(`
		SELECT
			h.resource_id,
			COALESCE(h.resource_name, h.resource_id),
			COALESCE(h.resource_type, ''),
			h.change_type,
			h.field_name,
			h.old_value,
			h.new_value,
			h.timestamp,
			COALESCE((
				SELECT SUM(c.cost)
				FROM costs c
				WHERE LOWER(c.resource_id) = LOWER(h.resource_id)
				AND c.period = (
					SELECT period FROM costs
					WHERE LOWER(resource_id) = LOWER(h.resource_id)
					ORDER BY fetched_at DESC LIMIT 1
				)
			), 0) as resource_cost
		FROM resource_history h
		ORDER BY h.timestamp DESC
		LIMIT 100`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var history []ResourceChange
	for rows.Next() {
		var h ResourceChange
		rows.Scan(&h.ResourceID, &h.ResourceName, &h.ResourceType, &h.ChangeType, &h.Field, &h.OldValue, &h.NewValue, &h.Timestamp, &h.Cost)
		history = append(history, h)
	}
	c.JSON(200, history)
}

type streamMsg struct {
	Type    string `json:"type"`
	SubID   string `json:"subId,omitempty"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

func sseHandler(c *gin.Context) {
	subs := c.QueryArray("subscriptionId")
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	msgChan := make(chan streamMsg, len(subs)*3)
	go func() {
		var uncached []string
		for _, sid := range subs {
			curr, ok1 := cache.get(sid, "current")
			if ok1 {
				msgChan <- streamMsg{Type: "data", SubID: sid, Data: gin.H{"current": normalizeResults(curr)}}
			}
			msgChan <- streamMsg{Type: "status", SubID: sid, Message: "synced"}
			if !ok1 {
				uncached = append(uncached, sid)
			}
		}

		// Fetch uncached subs in background with staggered delays
		if len(uncached) > 0 {
			go func(ids []string) {
				var wg sync.WaitGroup
				sem := make(chan struct{}, 2)
				for i, id := range ids {
					if i > 0 {
						time.Sleep(2 * time.Second)
					}
					wg.Add(1)
					go func(subID string) {
						defer wg.Done()
						sem <- struct{}{}
						defer func() { <-sem }()
						now := time.Now()
						ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
						defer cancel()
						fetchSubCostsSync(costClient, subID, "current", now.AddDate(0, 0, -30), ctx)
						if res, ok := cache.get(subID, "current"); ok {
							msgChan <- streamMsg{Type: "data", SubID: subID, Data: gin.H{"current": normalizeResults(res)}}
						}
					}(id)
				}
				done := make(chan struct{})
				go func() { wg.Wait(); close(done) }()
				select {
				case <-done:
					msgChan <- streamMsg{Type: "done"}
				case <-time.After(3 * time.Minute):
					msgChan <- streamMsg{Type: "done"}
				}
			}(uncached)
		} else {
			msgChan <- streamMsg{Type: "done"}
		}
	}()

	for msg := range msgChan {
		data, _ := json.Marshal(msg)
		c.SSEvent("message", string(data))
		c.Writer.Flush()
		if msg.Type == "done" {
			break
		}
	}
}

func backgroundSync(client *armcostmanagement.QueryClient) {
	ticker := time.NewTicker(2 * time.Hour)
	for range ticker.C {
		// Simplified background sync for CLI brevity
		log.Println("Background sync would run here...")
	}
}
