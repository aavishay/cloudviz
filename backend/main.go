package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"embed"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/costmanagement/armcostmanagement"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/resourcegraph/armresourcegraph"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/glebarez/go-sqlite"
	"github.com/spf13/cobra"
	"golang.org/x/time/rate"
	"io/fs"
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
	costLimiter    = rate.NewLimiter(rate.Limit(2), 5)
)

func main() {
	var rootCmd = &cobra.Command{
		Use:   "cloudviz",
		Short: "CloudViz is an Azure resource and cost management tool",
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
				name := r.Name
				if len(name) > 48 {
					name = name[:45] + "..."
				}
				resType := strings.Replace(r.Type, "microsoft.", "", 1)
				if len(resType) > 28 {
					resType = resType[:25] + "..."
				}
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

			res, err := fetchSubCostsSync(costClient, subID, "current", start, now, context.Background())
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
				rt := m["resourceType"].(string)
				if len(rt) > 28 {
					rt = rt[:25] + "..."
				}
				rg := m["resourceGroup"].(string)
				if len(rg) > 38 {
					rg = rg[:35] + "..."
				}
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

		// Fetch real daily cost data from Azure Cost Management for each subscription
		var allDaily []map[string]any
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 5)

		for _, sid := range subs {
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				daily, err := fetchDailyCosts(costClient, subID, start, now)
				if err != nil {
					log.Printf("Failed to fetch daily costs for %s: %v", subID, err)
					return
				}
				mu.Lock()
				allDaily = append(allDaily, daily...)
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		if len(allDaily) == 0 {
			// Fallback to aggregated totals spread across days
			var results []map[string]any
			totalCost := 0.0
			rows2, err := cache.db.Query("SELECT COALESCE(SUM(cost), 0) FROM costs WHERE subscription_id IN ("+placeholders(len(subs))+")", (func() []any {
				args := []any{}
				for _, s := range subs {
					args = append(args, s)
				}
				return args
			})()...)
			if err == nil {
				defer rows2.Close()
				if rows2.Next() {
					rows2.Scan(&totalCost)
				}
			}
			dailyAvg := totalCost / float64(days)
			for i := days - 1; i >= 0; i-- {
				date := now.AddDate(0, 0, -i)
				results = append(results, map[string]any{
					"date": date.Format("2006-01-02"),
					"cost": dailyAvg,
				})
			}
			c.JSON(200, results)
			return
		}

		// Group by date
		byDate := make(map[string]float64)
		for _, d := range allDaily {
			if date, ok := d["date"].(string); ok {
				byDate[date] += d["cost"].(float64)
			}
		}

		var results []map[string]any
		for i := days - 1; i >= 0; i-- {
			date := now.AddDate(0, 0, -i)
			dateStr := date.Format("2006-01-02")
			results = append(results, map[string]any{
				"date": dateStr,
				"cost": byDate[dateStr],
			})
		}
		c.JSON(200, results)
	})

	// Cost anomaly detection endpoint
	r.GET("/api/costs/anomalies", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		threshold := 2.0 // default: flag if cost is 2x or more of previous period
		if t := c.Query("threshold"); t != "" {
			fmt.Sscanf(t, "%f", &threshold)
		}

		now := time.Now()
		currentStart := now.AddDate(0, 0, -30)
		previousStart := now.AddDate(0, 0, -60)
		previousEnd := now.AddDate(0, 0, -30)

		var anomalies []map[string]any
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 5)

		for _, sid := range subs {
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				current, err1 := fetchDailyCosts(costClient, subID, currentStart, now)
				previous, err2 := fetchDailyCosts(costClient, subID, previousStart, previousEnd)

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

				// Compare each day in current period vs same day last period
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
						})
						mu.Unlock()
					}
				}
			}(sid)
		}
		wg.Wait()

		c.JSON(200, map[string]any{
			"anomalies":   anomalies,
			"threshold":   threshold,
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
		sem := make(chan struct{}, 10)

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
		sem := make(chan struct{}, 10)

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
		sem := make(chan struct{}, 5)

		for _, sid := range subs {
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				daily, err := fetchDailyCostsByType(costClient, subID, start, now)
				if err != nil {
					return
				}
				mu.Lock()
				allDaily = append(allDaily, daily...)
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

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
		sem := make(chan struct{}, 5)

		for _, sid := range subs {
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				// Current period
				curr, err1 := fetchDailyCosts(costClient, subID, currentStart, now)
				// Previous period
				prev, err2 := fetchDailyCosts(costClient, subID, previousStart, previousEnd)

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

	// Cost forecast using Azure's AI-powered forecast API
	r.GET("/api/costs/forecast", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		if len(subs) == 0 {
			c.JSON(400, gin.H{"error": "at least one subscriptionId is required"})
			return
		}

		now := time.Now()
		// Azure forecast API works best with a recent lookback + forecast window
		// Use billing month to date for best accuracy
		days := 30
		if d := c.Query("days"); d != "" {
			fmt.Sscanf(d, "%d", &days)
		}
		start := now.AddDate(0, 0, -days)

		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, 5)

		var totalActual, totalForecast float64
		var errors []string

		for _, sid := range subs {
			wg.Add(1)
			go func(subID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				actual, forecast, err := fetchForecast(forecastClient, subID, start, now)
				mu.Lock()
				if err != nil {
					errors = append(errors, fmt.Sprintf("%s: %v", subID, err))
				} else {
					totalActual += actual
					totalForecast += forecast
				}
				mu.Unlock()
			}(sid)
		}
		wg.Wait()

		if len(errors) > 0 && totalActual == 0 && totalForecast == 0 {
			c.JSON(502, gin.H{"error": "forecast queries failed", "details": errors})
			return
		}

		c.JSON(200, map[string]any{
			"actualCost":   totalActual,
			"forecastCost":  totalForecast,
			"periodDays":    days,
			"start":         start.Format("2006-01-02"),
			"end":           now.Format("2006-01-02"),
			"errors":        errors,
		})
	})

	r.GET("/api/costs", func(c *gin.Context) {
		subs := c.QueryArray("subscriptionId")
		rows, err := cache.db.Query("SELECT resource_group, resource_type, resource_location, cost, subscription_id FROM costs WHERE subscription_id IN ("+placeholders(len(subs))+")", (func() []any {
			args := []any{}
			for _, s := range subs {
				args = append(args, s)
			}
			return args
		})()...)
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

		res, _, err := FetchResourcesWithCosts(c.Request.Context(), subs, rgs, types, locs, search, orphaned, unattachedDiskOnly, unassignedPIPOnly, unattachedNICOnly, "", "")
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
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

		metrics, err := fetchHistoricalMetrics(c.Request.Context(), rid)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		reco, err := getOllamaRecommendation(metrics, rid)
		if err != nil {
			// Fallback is handled inside getOllamaRecommendation
			log.Printf("Ollama error: %v", err)
		}

		c.JSON(200, gin.H{
			"metrics":        metrics,
			"recommendation": reco,
		})
	})

	r.GET("/api/costs/stream", sseHandler)
	r.GET("/api/history", historyHandler)
	r.DELETE("/api/costs/cache", func(c *gin.Context) {
		cache.db.Exec("DELETE FROM costs")
		cache.db.Exec("DELETE FROM cost_type_daily")
		c.JSON(200, gin.H{"message": "Cache cleared"})
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
		rows.Scan(&h.ResourceID, &h.ResourceName, &h.ChangeType, &h.Field, &h.OldValue, &h.NewValue, &h.Timestamp, &h.Cost)
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

	msgChan := make(chan streamMsg)
	go func() {
		var wg sync.WaitGroup
		sem := make(chan struct{}, 15)
		for _, sid := range subs {
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				curr, ok1 := cache.get(id, "current")
				if ok1 {
					msgChan <- streamMsg{Type: "data", SubID: id, Data: gin.H{"current": normalizeResults(curr)}}
				} else {
					now := time.Now()
					fetchSubCostsSync(costClient, id, "current", now.AddDate(0, 0, -30), now, c.Request.Context())
					if res, ok := cache.get(id, "current"); ok {
						msgChan <- streamMsg{Type: "data", SubID: id, Data: gin.H{"current": normalizeResults(res)}}
					}
				}
				msgChan <- streamMsg{Type: "status", SubID: id, Message: "synced"}
			}(sid)
		}
		wg.Wait()
		msgChan <- streamMsg{Type: "done"}
		close(msgChan)
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
