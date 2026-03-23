package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
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
	cache       *dbCache
	costClient  *armcostmanagement.QueryClient
	argClient   *armresourcegraph.Client
	lastSync    time.Time
	syncMutex   sync.Mutex
	costLimiter = rate.NewLimiter(rate.Limit(2), 5)
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
		// Mock daily costs for the trend chart
		now := time.Now()
		var results []map[string]any
		for i := 29; i >= 0; i-- {
			date := now.AddDate(0, 0, -i)
			results = append(results, map[string]any{
				"date": date.Format("2006-01-02"),
				"cost": 1000.0 + (date.Unix()%100)*5,
			})
		}
		c.JSON(200, results)
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
	r.Run(":" + port)
}

func historyHandler(c *gin.Context) {
	rows, err := cache.db.Query(`SELECT resource_id, COALESCE(resource_name, resource_id), change_type, field_name, old_value, new_value, timestamp FROM resource_history ORDER BY timestamp DESC LIMIT 100`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var history []ResourceChange
	for rows.Next() {
		var h ResourceChange
		rows.Scan(&h.ResourceID, &h.ResourceName, &h.ChangeType, &h.Field, &h.OldValue, &h.NewValue, &h.Timestamp)
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
