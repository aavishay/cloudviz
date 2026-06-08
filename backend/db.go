package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/costmanagement/armcostmanagement"
)

type dbCache struct {
	db *sql.DB
}

func newDBCache(dbPath string) (*dbCache, error) {
	// file: URI enables per-connection _pragma parameters (applied on every new connection in the pool)
	dsn := "file:" + dbPath + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(15000)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS costs (
		subscription_id TEXT,
		resource_id TEXT,
		resource_group TEXT,
		resource_type TEXT,
		resource_location TEXT,
		cost REAL,
		period TEXT,
		fetched_at DATETIME
	)`)
	if err != nil {
		return nil, err
	}
	// Composite index for primary lookup pattern (subscription + period + date)
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_costs_sub_period ON costs(subscription_id, period, fetched_at)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}
	// Covering index for resource cost lookups
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_costs_resource_lookup ON costs(resource_id, subscription_id, cost)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}
	// Index for resource group + type aggregations
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_costs_rg_type ON costs(resource_group, resource_type, resource_location, cost)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}
	// Index for period-based queries
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_costs_period ON costs(period, fetched_at)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS resources (
		id TEXT PRIMARY KEY,
		name TEXT,
		type TEXT,
		location TEXT,
		subscription_id TEXT,
		resource_group TEXT,
		tags TEXT,
		status TEXT,
		managed_by TEXT,
		fetched_at DATETIME
	)`)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_resources_sub ON resources(subscription_id)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS resource_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		resource_id TEXT,
		resource_name TEXT,
		change_type TEXT,
		field_name TEXT,
		old_value TEXT,
		new_value TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_history_resource ON resource_history(resource_id)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_history_timestamp ON resource_history(timestamp)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_history_date_change ON resource_history(date(datetime(timestamp,'localtime')), change_type)`); err != nil {
		log.Printf("Warning: failed to create date index: %v", err)
	}
	// Add resource_type column if it doesn't already exist (SQLite has no IF NOT EXISTS for ADD COLUMN)
	var hasResourceType bool
	if rows, err := db.Query("PRAGMA table_info(resource_history)"); err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notNull, dfltValue, pk int
			rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk)
			if name == "resource_type" {
				hasResourceType = true
				break
			}
		}
		rows.Close()
	}
	if !hasResourceType {
		if _, err := db.Exec(`ALTER TABLE resource_history ADD COLUMN resource_type TEXT`); err != nil {
			log.Printf("Warning: failed to add resource_type column: %v", err)
		}
	}

	// Add changed_by column if it doesn't exist
	var hasChangedBy bool
	if rows, err := db.Query("PRAGMA table_info(resource_history)"); err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notNull, dfltValue, pk int
			rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk)
			if name == "changed_by" {
				hasChangedBy = true
				break
			}
		}
		rows.Close()
	}
	if !hasChangedBy {
		if _, err := db.Exec(`ALTER TABLE resource_history ADD COLUMN changed_by TEXT`); err != nil {
			log.Printf("Warning: failed to add changed_by column: %v", err)
		}
	}

	// Add resource_cost column to history if missing
	var hasResourceCost bool
	if rows, err := db.Query("PRAGMA table_info(resource_history)"); err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notNull, dfltValue, pk int
			rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk)
			if name == "resource_cost" {
				hasResourceCost = true
				break
			}
		}
		rows.Close()
	}
	if !hasResourceCost {
		if _, err := db.Exec(`ALTER TABLE resource_history ADD COLUMN resource_cost REAL DEFAULT 0`); err != nil {
			log.Printf("Warning: failed to add resource_cost column: %v", err)
		}
	}

	// Add managed_by column to resources if missing
	var hasManagedBy bool
	if rows, err := db.Query("PRAGMA table_info(resources)"); err == nil {
		for rows.Next() {
			var cid int
			var name, ctype string
			var notNull, dfltValue, pk int
			rows.Scan(&cid, &name, &ctype, &notNull, &dfltValue, &pk)
			if name == "managed_by" {
				hasManagedBy = true
				break
			}
		}
		rows.Close()
	}
	if !hasManagedBy {
		if _, err := db.Exec(`ALTER TABLE resources ADD COLUMN managed_by TEXT`); err != nil {
			log.Printf("Warning: failed to add managed_by column: %v", err)
		}
	}

	// Retroactively fill changed_by from resource tags for 'Unknown' created events
	go func() {
		rows, err := db.Query(`SELECT DISTINCT h.resource_id, r.tags FROM resource_history h JOIN resources r ON LOWER(h.resource_id) = LOWER(r.id) WHERE (h.changed_by IS NULL OR h.changed_by = 'Unknown') AND h.change_type = 'created' AND r.tags IS NOT NULL AND r.tags != '{}'`)
		if err != nil {
			return
		}
		defer rows.Close()
		type pair struct{ id, tags string }
		var pairs []pair
		for rows.Next() {
			var p pair
			if rows.Scan(&p.id, &p.tags) == nil {
				pairs = append(pairs, p)
			}
		}
		rows.Close()
		for _, p := range pairs {
			var tags map[string]string
			if err := json.Unmarshal([]byte(p.tags), &tags); err != nil {
				continue
			}
			creator := extractCreatorFromTags(tags)
			if creator == "" {
				continue
			}
			db.Exec(`UPDATE resource_history SET changed_by = ? WHERE resource_id = ? AND change_type = 'created' AND (changed_by IS NULL OR changed_by = 'Unknown')`, creator, p.id)
		}
	}()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS budgets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		amount REAL NOT NULL,
		subscription_id TEXT,
		resource_group TEXT,
		period TEXT DEFAULT 'monthly',
		alert_email TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cost_type_daily (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		cache_key TEXT,
		dates TEXT,
		types TEXT,
		fetched_at DATETIME
	)`)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_type_daily_key ON cost_type_daily(cache_key)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	// Migrate old per-sub schema to new composite-key schema
	if _, err := db.Exec(`ALTER TABLE cost_type_daily ADD COLUMN cache_key TEXT`); err != nil {
		// Column may already exist, ignore error
	}
	var oldCount int
	row := db.QueryRow("SELECT COUNT(*) FROM cost_type_daily WHERE cache_key IS NULL OR cache_key = ''")
	if row != nil {
		row.Scan(&oldCount)
	}
	if oldCount > 0 {
		// Old rows exist; drop and recreate clean
		if _, err := db.Exec("DROP TABLE IF EXISTS cost_type_daily"); err != nil {
			log.Printf("Warning: failed to drop old table: %v", err)
		}
		if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS cost_type_daily (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cache_key TEXT,
			dates TEXT,
			types TEXT,
			fetched_at DATETIME
		)`); err != nil {
			return nil, err
		}
		if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_type_daily_key ON cost_type_daily(cache_key)`); err != nil {
			log.Printf("Warning: failed to create index: %v", err)
		}
		log.Println("Migrated cost_type_daily schema: dropped", oldCount, "old rows")
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_budgets_sub ON budgets(subscription_id)`); err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cost_forecast (
		subscription_id TEXT,
		actual_cost REAL,
		forecast_cost REAL,
		days INTEGER,
		fetched_at DATETIME
	)`)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_forecast_sub_days ON cost_forecast(subscription_id, days)`); err != nil {
		log.Printf("Warning: failed to create forecast index: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cost_daily (
		subscription_id TEXT,
		date TEXT,
		cost REAL,
		fetched_at DATETIME
	)`)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_daily_sub_date ON cost_daily(subscription_id, date)`); err != nil {
		log.Printf("Warning: failed to create daily index: %v", err)
	}

	// Cached aggregated sums table - avoids recalculating totals
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cost_aggregates (
		subscription_id TEXT,
		period TEXT,
		total_cost REAL,
		resource_count INTEGER,
		fetched_at DATETIME,
		PRIMARY KEY (subscription_id, period)
	)`)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_aggregates_fetch ON cost_aggregates(fetched_at)`); err != nil {
		log.Printf("Warning: failed to create aggregate index: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'budget',
		threshold REAL NOT NULL,
		email TEXT,
		webhook_url TEXT,
		enabled INTEGER DEFAULT 1,
		subscription_id TEXT,
		resource_group TEXT,
		period TEXT DEFAULT 'monthly',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return nil, err
	}
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_alerts_sub ON alerts(subscription_id)`)

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS sla_tracking (
		resource_id TEXT PRIMARY KEY,
		resource_name TEXT,
		resource_group TEXT,
		subscription_id TEXT,
		uptime_percentage REAL,
		downtime_hours REAL,
		total_hours REAL,
		status TEXT,
		last_checked DATETIME
	)`)
	if err != nil {
		log.Printf("Warning: failed to create sla_tracking table: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_sla_sub ON sla_tracking(subscription_id)`); err != nil {
		log.Printf("Warning: failed to create sla index: %v", err)
	}

	// Create webhook deliveries table
	if err := CreateWebhookDeliveriesTable(db); err != nil {
		return nil, err
	}

	// Create dependencies table
	if err := CreateDependenciesTable(db); err != nil {
		return nil, err
	}

	// Metrics cache table - stores VM/resource metrics to avoid repeated Azure Monitor API calls
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS metrics_cache (
		resource_id TEXT PRIMARY KEY,
		resource_type TEXT,
		metrics_json TEXT,
		fetched_at DATETIME
	)`)
	if err != nil {
		log.Printf("Warning: failed to create metrics_cache table: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_metrics_fetched ON metrics_cache(fetched_at)`); err != nil {
		log.Printf("Warning: failed to create metrics_cache index: %v", err)
	}

	// Advisor recommendations cache
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS advisor_cache (
		subscription_id TEXT,
		category TEXT,
		recommendations_json TEXT,
		fetched_at DATETIME,
		PRIMARY KEY (subscription_id, category)
	)`)
	if err != nil {
		log.Printf("Warning: failed to create advisor_cache table: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_advisor_fetched ON advisor_cache(fetched_at)`); err != nil {
		log.Printf("Warning: failed to create advisor_cache index: %v", err)
	}

	// VM simple metrics cache - stores avgCPU and avgMemory for idle detection
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS vm_metrics_cache (
		resource_id TEXT PRIMARY KEY,
		days INTEGER,
		avg_cpu REAL,
		avg_memory REAL,
		fetched_at DATETIME
	)`)
	if err != nil {
		log.Printf("Warning: failed to create vm_metrics_cache table: %v", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_vm_metrics_fetched ON vm_metrics_cache(fetched_at)`); err != nil {
		log.Printf("Warning: failed to create vm_metrics_cache index: %v", err)
	}

	return &dbCache{db: db}, nil
}

func (dc *dbCache) get(subID string, period string) (armcostmanagement.QueryResult, bool) {
	var fetchedAt time.Time
	err := dc.db.QueryRow("SELECT fetched_at FROM costs WHERE subscription_id = ? AND period = ? LIMIT 1", subID, period).Scan(&fetchedAt)
	if err != nil {
		return armcostmanagement.QueryResult{}, false
	}
	// Current period: 6h TTL so cost data stays reasonably fresh.
	// Previous period: 7-day TTL — the Apr→May window barely shifts daily,
	// and stale previous data is far better than no previous data at all
	// (missing previous data makes Month-over-Month look like a false increase).
	ttl := 6 * time.Hour
	if period == "previous" {
		ttl = 7 * 24 * time.Hour
	}
	if time.Since(fetchedAt) > ttl {
		return armcostmanagement.QueryResult{}, false
	}

	rows, err := dc.db.Query("SELECT cost, resource_id, resource_group, resource_type, resource_location FROM costs WHERE subscription_id = ? AND period = ?", subID, period)
	if err != nil {
		return armcostmanagement.QueryResult{}, false
	}
	defer rows.Close()

	var resultRows [][]any
	for rows.Next() {
		var cost float64
		var id, rg, rt, rl string
		if err := rows.Scan(&cost, &id, &rg, &rt, &rl); err == nil {
			resultRows = append(resultRows, []any{cost, id, rg, rt, rl})
		}
	}

	return armcostmanagement.QueryResult{
		Properties: &armcostmanagement.QueryProperties{
			Rows: resultRows,
		},
	}, true
}

func (dc *dbCache) set(subID string, period string, data armcostmanagement.QueryResult) {
	if data.Properties == nil || data.Properties.Rows == nil {
		return
	}

	if _, err := dc.db.Exec("DELETE FROM costs WHERE subscription_id = ? AND period = ?", subID, period); err != nil {
		log.Printf("Warning: failed to delete old costs: %v", err)
	}

	tx, err := dc.db.Begin()
	if err != nil {
		log.Printf("Error: failed to begin transaction: %v", err)
		return
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO costs (subscription_id, resource_id, resource_group, resource_type, resource_location, cost, period, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		log.Printf("Error: failed to prepare statement: %v", err)
		return
	}
	defer stmt.Close()

	colCost, colId, colRg, colType, colLoc := 0, -1, -1, -1, -1
	if data.Properties.Columns != nil {
		for i, col := range data.Properties.Columns {
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

	now := time.Now()
	for _, row := range data.Properties.Rows {
		if len(row) < 1 {
			continue
		}

		getVal := func(idx int) string {
			if idx >= 0 && idx < len(row) && row[idx] != nil {
				return fmt.Sprintf("%v", row[idx])
			}
			return ""
		}

		var cost float64
		if colCost < len(row) {
			cost = parseFloatVal(row[colCost])
		}

		rid := getVal(colId)
		rg := strings.ToLower(getVal(colRg))
		rt := strings.ToLower(getVal(colType))
		rl := normalizeLocation(getVal(colLoc))

		if _, err := stmt.Exec(subID, rid, rg, rt, rl, cost, period, now); err != nil {
			log.Printf("Warning: failed to insert cost: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		log.Printf("Error: failed to commit transaction: %v", err)
	}
}

func (dc *dbCache) getTypeDaily(cacheKey string) (dates []map[string]any, types []string, ok bool) {
	var fetchedAt time.Time
	var datesJSON, typesJSON string
	err := dc.db.QueryRow("SELECT fetched_at, dates, types FROM cost_type_daily WHERE cache_key = ?", cacheKey).Scan(&fetchedAt, &datesJSON, &typesJSON)
	if err != nil || time.Since(fetchedAt) > 6*time.Hour {
		return nil, nil, false
	}
	if err := json.Unmarshal([]byte(datesJSON), &dates); err != nil {
		log.Printf("Warning: failed to unmarshal dates: %v", err)
		return nil, nil, false
	}
	if err := json.Unmarshal([]byte(typesJSON), &types); err != nil {
		log.Printf("Warning: failed to unmarshal types: %v", err)
		return nil, nil, false
	}
	return dates, types, true
}

func (dc *dbCache) setTypeDaily(cacheKey string, dates []map[string]any, types []string) {
	now := time.Now()
	datesJSON, err := json.Marshal(dates)
	if err != nil {
		log.Printf("Warning: failed to marshal dates: %v", err)
		return
	}
	typesJSON, err := json.Marshal(types)
	if err != nil {
		log.Printf("Warning: failed to marshal types: %v", err)
		return
	}
	if _, err := dc.db.Exec("DELETE FROM cost_type_daily WHERE cache_key = ?", cacheKey); err != nil {
		log.Printf("Warning: failed to delete old daily costs: %v", err)
	}
	if _, err := dc.db.Exec("INSERT INTO cost_type_daily (cache_key, dates, types, fetched_at) VALUES (?, ?, ?, ?)",
		cacheKey, string(datesJSON), string(typesJSON), now); err != nil {
		log.Printf("Warning: failed to insert daily costs: %v", err)
	}
}

func (dc *dbCache) getForecast(subID string, days int) (actualCost, forecastCost float64, ok bool) {
	var fetchedAt time.Time
	err := dc.db.QueryRow("SELECT actual_cost, forecast_cost, fetched_at FROM cost_forecast WHERE subscription_id = ? AND days = ?", subID, days).Scan(&actualCost, &forecastCost, &fetchedAt)
	if err != nil || time.Since(fetchedAt) > 24*time.Hour {
		return 0, 0, false
	}
	return actualCost, forecastCost, true
}

func (dc *dbCache) setForecast(subID string, days int, actualCost, forecastCost float64) {
	tx, err := dc.db.Begin()
	if err != nil {
		log.Printf("Warning: failed to begin forecast tx: %v", err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM cost_forecast WHERE subscription_id = ? AND days = ?", subID, days); err != nil {
		log.Printf("Warning: failed to delete old forecast: %v", err)
	}
	if _, err := tx.Exec("INSERT INTO cost_forecast (subscription_id, actual_cost, forecast_cost, days, fetched_at) VALUES (?, ?, ?, ?, ?)",
		subID, actualCost, forecastCost, days, time.Now()); err != nil {
		log.Printf("Warning: failed to insert forecast: %v", err)
	}
	if err := tx.Commit(); err != nil {
		log.Printf("Warning: failed to commit forecast tx: %v", err)
	}
}

func (dc *dbCache) getDailyCosts(subID string, start, end time.Time) ([]map[string]any, bool) {
	rows, err := dc.db.Query("SELECT date, cost, fetched_at FROM cost_daily WHERE subscription_id = ? AND date >= ? AND date <= ?", subID, start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	var results []map[string]any
	var maxAge time.Duration
	for rows.Next() {
		var date string
		var cost float64
		var fetchedAt time.Time
		if err := rows.Scan(&date, &cost, &fetchedAt); err != nil {
			continue
		}
		results = append(results, map[string]any{"date": date, "cost": cost})
		age := time.Since(fetchedAt)
		if age > maxAge {
			maxAge = age
		}
	}
	if len(results) == 0 || maxAge > 24*time.Hour {
		return results, false
	}
	return results, true
}

func (dc *dbCache) setDailyCosts(subID string, items []map[string]any) {
	if _, err := dc.db.Exec("DELETE FROM cost_daily WHERE subscription_id = ?", subID); err != nil {
		log.Printf("Warning: failed to delete old daily costs: %v", err)
	}
	stmt, err := dc.db.Prepare("INSERT INTO cost_daily (subscription_id, date, cost, fetched_at) VALUES (?, ?, ?, ?)")
	if err != nil {
		log.Printf("Warning: failed to prepare daily costs: %v", err)
		return
	}
	defer stmt.Close()
	now := time.Now()
	for _, item := range items {
		date, _ := item["date"].(string)
		cost, _ := item["cost"].(float64)
		if date == "" {
			continue
		}
		if _, err := stmt.Exec(subID, date, cost, now); err != nil {
			log.Printf("Warning: failed to insert daily cost: %v", err)
		}
	}
}

// populateCostsFromDaily aggregates daily cost data and inserts into costs table
// This ensures the costs table stays in sync with cost_daily for display purposes
func (dc *dbCache) populateCostsFromDaily(subID string, daily []map[string]any, period string) {
	// Calculate total cost from daily entries
	var totalCost float64
	for _, item := range daily {
		if cost, ok := item["cost"].(float64); ok {
			totalCost += cost
		}
	}
	if totalCost <= 0 {
		return
	}

	// Delete old aggregate entry for this subscription/period
	if _, err := dc.db.Exec("DELETE FROM costs WHERE subscription_id = ? AND period = ? AND resource_id = 'daily-aggregate'", subID, period); err != nil {
		log.Printf("Warning: failed to delete old daily aggregate cost: %v", err)
	}

	// Insert aggregate cost entry
	now := time.Now()
	_, err := dc.db.Exec(
		"INSERT INTO costs (subscription_id, resource_id, resource_group, resource_type, resource_location, cost, period, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		subID, "daily-aggregate", "", "DailyAggregate", "", totalCost, period, now,
	)
	if err != nil {
		log.Printf("Warning: failed to insert daily aggregate cost: %v", err)
	}
}

// Batch cache operations for improved performance

// getBatch returns cached cost data for multiple subscriptions in a single query
func (dc *dbCache) getBatch(subIDs []string, period string) (map[string]armcostmanagement.QueryResult, []string) {
	if len(subIDs) == 0 {
		return make(map[string]armcostmanagement.QueryResult), nil
	}

	// Build placeholders for IN clause
	placeholders := make([]string, len(subIDs))
	args := make([]any, len(subIDs))
	for i, subID := range subIDs {
		placeholders[i] = "?"
		args[i] = subID
	}
	args = append(args, period)

	// Get all costs for the subscriptions in one query
	query := fmt.Sprintf(`SELECT subscription_id, cost, resource_id, resource_group, resource_type, resource_location, fetched_at
		FROM costs WHERE subscription_id IN (%s) AND period = ?`,
		strings.Join(placeholders, ","))

	rows, err := dc.db.Query(query, args...)
	if err != nil {
		return make(map[string]armcostmanagement.QueryResult), subIDs
	}
	defer rows.Close()

	results := make(map[string]armcostmanagement.QueryResult)
	fetchedAtMap := make(map[string]time.Time)

	for rows.Next() {
		var subID, id, rg, rt, rl string
		var cost float64
		var fetchedAt time.Time
		if err := rows.Scan(&subID, &cost, &id, &rg, &rt, &rl, &fetchedAt); err != nil {
			continue
		}
		if existing, ok := results[subID]; ok {
			existing.Properties.Rows = append(existing.Properties.Rows, []any{cost, id, rg, rt, rl})
		} else {
			results[subID] = armcostmanagement.QueryResult{
				Properties: &armcostmanagement.QueryProperties{
					Rows: [][]any{{cost, id, rg, rt, rl}},
				},
			}
		}
		fetchedAtMap[subID] = fetchedAt
	}

	// Check freshness and return missing subscriptions
	var missing []string
	for _, subID := range subIDs {
		if fetchedAt, ok := fetchedAtMap[subID]; !ok || time.Since(fetchedAt) > 24*time.Hour {
			missing = append(missing, subID)
			delete(results, subID)
		}
	}

	return results, missing
}

// getAggregate returns cached aggregate totals for a subscription/period
func (dc *dbCache) getAggregate(subID, period string) (totalCost float64, resourceCount int, ok bool) {
	var fetchedAt time.Time
	err := dc.db.QueryRow(
		"SELECT total_cost, resource_count, fetched_at FROM cost_aggregates WHERE subscription_id = ? AND period = ?",
		subID, period).Scan(&totalCost, &resourceCount, &fetchedAt)
	if err != nil || time.Since(fetchedAt) > 24*time.Hour {
		return 0, 0, false
	}
	return totalCost, resourceCount, true
}

// setAggregate caches aggregate totals for a subscription/period
func (dc *dbCache) setAggregate(subID, period string, totalCost float64, resourceCount int) {
	_, err := dc.db.Exec(
		`INSERT OR REPLACE INTO cost_aggregates (subscription_id, period, total_cost, resource_count, fetched_at)
		VALUES (?, ?, ?, ?, ?)`,
		subID, period, totalCost, resourceCount, time.Now())
	if err != nil {
		log.Printf("Warning: failed to cache aggregate: %v", err)
	}
}

// getCachedSubscriptions returns subscriptions that have fresh cached data
func (dc *dbCache) getCachedSubscriptions(subIDs []string, period string) ([]string, []string) {
	if len(subIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(subIDs))
	args := make([]any, len(subIDs))
	for i, subID := range subIDs {
		placeholders[i] = "?"
		args[i] = subID
	}
	args = append(args, period)

	query := fmt.Sprintf(
		`SELECT DISTINCT subscription_id FROM costs
		WHERE subscription_id IN (%s) AND period = ? AND fetched_at > datetime('now', '-6 hours')`,
		strings.Join(placeholders, ","))

	rows, err := dc.db.Query(query, args...)
	if err != nil {
		return nil, subIDs
	}
	defer rows.Close()

	cached := make(map[string]bool)
	for rows.Next() {
		var subID string
		if rows.Scan(&subID) == nil {
			cached[subID] = true
		}
	}

	var cachedSubs, missingSubs []string
	for _, subID := range subIDs {
		if cached[subID] {
			cachedSubs = append(cachedSubs, subID)
		} else {
			missingSubs = append(missingSubs, subID)
		}
	}
	return cachedSubs, missingSubs
}

func recordResourceChanges(db *sql.DB, newResources []AzureResource) {
	now := time.Now()
	rows, err := db.Query("SELECT id, name, type, location, subscription_id, resource_group, tags, status, managed_by FROM resources")
	if err != nil {
		log.Printf("Warning: failed to query resources: %v", err)
		return
	}
	defer rows.Close()

	oldMap := make(map[string]AzureResource)
	for rows.Next() {
		var r AzureResource
		var tagsJSON string
		if err := rows.Scan(&r.ID, &r.Name, &r.Type, &r.Location, &r.SubscriptionID, &r.ResourceGroup, &tagsJSON, &r.Status, &r.ManagedBy); err == nil {
			if tagsJSON != "" {
				_ = json.Unmarshal([]byte(tagsJSON), &r.Tags)
			}
			oldMap[r.ID] = r
		}
	}
	rows.Close()

	// Skip detailed change recording on the very first sync (oldMap empty = initial load)
	// to avoid recording 400K+ "created" events that flood the history table uselessly
	isInitialLoad := len(oldMap) == 0

	// Get unique subscription IDs from new and old resources
	subMap := make(map[string]bool)
	for _, r := range newResources {
		subMap[r.SubscriptionID] = true
	}
	for _, r := range oldMap {
		subMap[r.SubscriptionID] = true
	}

	// Fetch activity logs only on incremental syncs (skip initial load to avoid huge transactions)
	ctx := context.Background()
	activityLogs := make(map[string]map[string][]ActivityLogEvent)
	if !isInitialLoad {
		for subID := range subMap {
			startTime := now.Add(-2 * time.Hour)
			logs, err := fetchActivityLogs(ctx, subID, startTime, now)
			if err != nil {
				log.Printf("Warning: failed to fetch activity logs for sub %s: %v", subID, err)
				continue
			}
			activityLogs[subID] = logs
		}
	}

	// Use a single transaction for all changes
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error: failed to begin transaction: %v", err)
		return
	}
	defer tx.Rollback()

	changeStmt, err := tx.Prepare(`INSERT INTO resource_history (resource_id, resource_name, resource_type, change_type, field_name, old_value, new_value, timestamp, changed_by, resource_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		log.Printf("Error: failed to prepare change statement: %v", err)
		return
	}
	defer changeStmt.Close()

	// Build a cost map from the current costs table so we can capture cost at change time
	costMap := make(map[string]float64)
	if costRows, err := db.Query(`SELECT resource_id, SUM(cost) FROM costs WHERE period = 'current' GROUP BY resource_id`); err == nil {
		for costRows.Next() {
			var rid string
			var cost float64
			if costRows.Scan(&rid, &cost) == nil {
				costMap[strings.ToLower(rid)] = cost
			}
		}
		costRows.Close()
	}
	costFor := func(id string) float64 { return costMap[strings.ToLower(id)] }

	newMap := make(map[string]AzureResource)
	changeTime := now
	for _, r := range newResources {
		newMap[r.ID] = r
		if isInitialLoad {
			continue
		}
		subLogs := activityLogs[r.SubscriptionID]

		if old, exists := oldMap[r.ID]; exists {
			if old.Name != r.Name {
				user := findUserForChange(subLogs, r.ID, changeTime)
				recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "modified", "name", old.Name, r.Name, user, 0)
			}
			if old.Status != r.Status {
				user := findUserForChange(subLogs, r.ID, changeTime)
				recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "modified", "status", old.Status, r.Status, user, 0)
			}
			if old.Location != r.Location {
				user := findUserForChange(subLogs, r.ID, changeTime)
				recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "modified", "location", old.Location, r.Location, user, 0)
			}
			if old.ResourceGroup != r.ResourceGroup {
				user := findUserForChange(subLogs, r.ID, changeTime)
				recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "modified", "resourceGroup", old.ResourceGroup, r.ResourceGroup, user, 0)
			}
			if old.Type != r.Type {
				user := findUserForChange(subLogs, r.ID, changeTime)
				recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "modified", "type", old.Type, r.Type, user, 0)
			}
			oldTagsJSON, _ := json.Marshal(old.Tags)
			newTagsJSON, _ := json.Marshal(r.Tags)
			if string(oldTagsJSON) != string(newTagsJSON) {
				user := findUserForChange(subLogs, r.ID, changeTime)
				recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "modified", "tags", string(oldTagsJSON), string(newTagsJSON), user, 0)
			}
		} else {
			user := findUserForChange(subLogs, r.ID, changeTime)
			if user == "Unknown" && r.CreatedBy != "" {
				user = r.CreatedBy
			}
			recordChangeStmtWithCost(changeStmt, r.ID, r.Name, r.Type, "created", "", "", "", user, costFor(r.ID))
		}
	}

	if !isInitialLoad {
		for id, old := range oldMap {
			if _, exists := newMap[id]; !exists {
				subLogs := activityLogs[old.SubscriptionID]
				user := findUserForChange(subLogs, id, changeTime)
				recordChangeStmtWithCost(changeStmt, id, old.Name, old.Type, "deleted", "", "", "", user, costFor(id))
			}
		}
	}

	if _, err := tx.Exec("DELETE FROM resources"); err != nil {
		log.Printf("Warning: failed to delete old resources: %v", err)
	}

	resourceStmt, err := tx.Prepare("INSERT OR REPLACE INTO resources (id, name, type, location, subscription_id, resource_group, tags, status, managed_by, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		log.Printf("Error: failed to prepare resource statement: %v", err)
		return
	}
	defer resourceStmt.Close()

	for _, r := range newResources {
		tagsJSON, err := json.Marshal(r.Tags)
		if err != nil {
			log.Printf("Warning: failed to marshal tags: %v", err)
			tagsJSON = []byte("{}")
		}
		if _, err := resourceStmt.Exec(r.ID, r.Name, r.Type, r.Location, r.SubscriptionID, r.ResourceGroup, string(tagsJSON), r.Status, r.ManagedBy, now); err != nil {
			log.Printf("Warning: failed to insert resource: %v", err)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Error: failed to commit transaction: %v", err)
	}
}

// recordChangeStmtWithCost records a change with user and resource cost at time of change
func recordChangeStmtWithCost(stmt *sql.Stmt, resourceID, resourceName, resourceType, changeType, field, oldVal, newVal, user string, cost float64) {
	if user == "" {
		user = "Unknown"
	}
	if _, err := stmt.Exec(resourceID, resourceName, resourceType, changeType, field, oldVal, newVal, time.Now(), user, cost); err != nil {
		log.Printf("Warning: failed to record change: %v", err)
	}
}

// recordChangeStmtWithUser records a change with user information (kept for compatibility)
func recordChangeStmtWithUser(stmt *sql.Stmt, resourceID, resourceName, resourceType, changeType, field, oldVal, newVal, user string) {
	recordChangeStmtWithCost(stmt, resourceID, resourceName, resourceType, changeType, field, oldVal, newVal, user, 0)
}

// recordChangeStmt records a change using a prepared statement (backward compatible)
func recordChangeStmt(stmt *sql.Stmt, resourceID, resourceName, resourceType, changeType, field, oldVal, newVal string) {
	recordChangeStmtWithCost(stmt, resourceID, resourceName, resourceType, changeType, field, oldVal, newVal, "Unknown", 0)
}

func recordChange(db *sql.DB, resourceID, resourceName, resourceType, changeType, field, oldVal, newVal string) {
	if _, err := db.Exec(`INSERT INTO resource_history (resource_id, resource_name, resource_type, change_type, field_name, old_value, new_value, timestamp, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		resourceID, resourceName, resourceType, changeType, field, oldVal, newVal, time.Now(), "Unknown"); err != nil {
		log.Printf("Warning: failed to record change: %v", err)
	}
}

// Metrics cache operations

func (dc *dbCache) getMetrics(resourceID string) (map[string][]float64, bool) {
	var metricsJSON string
	var fetchedAt time.Time
	err := dc.db.QueryRow("SELECT metrics_json, fetched_at FROM metrics_cache WHERE resource_id = ?", resourceID).Scan(&metricsJSON, &fetchedAt)
	if err != nil {
		return nil, false
	}
	// 30 minute TTL for metrics - they're relatively stable
	if time.Since(fetchedAt) > 30*time.Minute {
		return nil, false
	}
	var metrics map[string][]float64
	if err := json.Unmarshal([]byte(metricsJSON), &metrics); err != nil {
		log.Printf("Warning: failed to unmarshal metrics cache: %v", err)
		return nil, false
	}
	return metrics, true
}

func (dc *dbCache) setMetrics(resourceID, resourceType string, metrics map[string][]float64) {
	metricsJSON, err := json.Marshal(metrics)
	if err != nil {
		log.Printf("Warning: failed to marshal metrics: %v", err)
		return
	}
	_, err = dc.db.Exec(
		"INSERT OR REPLACE INTO metrics_cache (resource_id, resource_type, metrics_json, fetched_at) VALUES (?, ?, ?, ?)",
		resourceID, resourceType, string(metricsJSON), time.Now())
	if err != nil {
		log.Printf("Warning: failed to cache metrics: %v", err)
	}
}

// Advisor recommendations cache operations

func (dc *dbCache) getAdvisorRecommendations(subID, category string) ([]map[string]any, bool) {
	var recsJSON string
	var fetchedAt time.Time
	err := dc.db.QueryRow("SELECT recommendations_json, fetched_at FROM advisor_cache WHERE subscription_id = ? AND category = ?", subID, category).Scan(&recsJSON, &fetchedAt)
	if err != nil {
		return nil, false
	}
	// 6 hour TTL for advisor recommendations
	if time.Since(fetchedAt) > 6*time.Hour {
		return nil, false
	}
	var recommendations []map[string]any
	if err := json.Unmarshal([]byte(recsJSON), &recommendations); err != nil {
		log.Printf("Warning: failed to unmarshal advisor cache: %v", err)
		return nil, false
	}
	return recommendations, true
}

func (dc *dbCache) setAdvisorRecommendations(subID, category string, recommendations []map[string]any) {
	recsJSON, err := json.Marshal(recommendations)
	if err != nil {
		log.Printf("Warning: failed to marshal advisor recommendations: %v", err)
		return
	}
	_, err = dc.db.Exec(
		"INSERT OR REPLACE INTO advisor_cache (subscription_id, category, recommendations_json, fetched_at) VALUES (?, ?, ?, ?)",
		subID, category, string(recsJSON), time.Now())
	if err != nil {
		log.Printf("Warning: failed to cache advisor recommendations: %v", err)
	}
}

// VM simple metrics cache operations (for idle detection)

func (dc *dbCache) getVMMetrics(resourceID string, days int) (avgCPU, avgMemory float64, ok bool) {
	var fetchedAt time.Time
	err := dc.db.QueryRow("SELECT avg_cpu, avg_memory, fetched_at FROM vm_metrics_cache WHERE resource_id = ? AND days = ?", resourceID, days).Scan(&avgCPU, &avgMemory, &fetchedAt)
	if err != nil {
		return -1, -1, false
	}
	// 30 minute TTL for VM metrics
	if time.Since(fetchedAt) > 30*time.Minute {
		return -1, -1, false
	}
	return avgCPU, avgMemory, true
}

func (dc *dbCache) setVMMetrics(resourceID string, days int, avgCPU, avgMemory float64) {
	_, err := dc.db.Exec(
		"INSERT OR REPLACE INTO vm_metrics_cache (resource_id, days, avg_cpu, avg_memory, fetched_at) VALUES (?, ?, ?, ?, ?)",
		resourceID, days, avgCPU, avgMemory, time.Now())
	if err != nil {
		log.Printf("Warning: failed to cache VM metrics: %v", err)
	}
}
