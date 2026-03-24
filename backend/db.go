package main

import (
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
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL")
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
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_costs_sub_period ON costs(subscription_id, period)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_costs_resource_id ON costs(resource_id)`)

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS resources (
		id TEXT PRIMARY KEY,
		name TEXT,
		type TEXT,
		location TEXT,
		subscription_id TEXT,
		resource_group TEXT,
		tags TEXT,
		status TEXT,
		fetched_at DATETIME
	)`)
	if err != nil {
		return nil, err
	}
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_resources_sub ON resources(subscription_id)`)

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
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_history_resource ON resource_history(resource_id)`)
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_history_timestamp ON resource_history(timestamp)`)

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
	db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_type_daily_key ON cost_type_daily(cache_key)`)

	// Migrate old per-sub schema to new composite-key schema
	db.Exec(`ALTER TABLE cost_type_daily ADD COLUMN cache_key TEXT`)
	var oldCount int
	row := db.QueryRow("SELECT COUNT(*) FROM cost_type_daily WHERE cache_key IS NULL OR cache_key = ''")
	if row != nil {
		row.Scan(&oldCount)
	}
	if oldCount > 0 {
		// Old rows exist; drop and recreate clean
		db.Exec("DROP TABLE IF EXISTS cost_type_daily")
		db.Exec(`CREATE TABLE IF NOT EXISTS cost_type_daily (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			cache_key TEXT,
			dates TEXT,
			types TEXT,
			fetched_at DATETIME
		)`)
		db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_type_daily_key ON cost_type_daily(cache_key)`)
		log.Println("Migrated cost_type_daily schema: dropped", oldCount, "old rows")
	}
	if err != nil {
		return nil, err
	}
	db.Exec(`CREATE INDEX IF NOT EXISTS idx_budgets_sub ON budgets(subscription_id)`)

	return &dbCache{db: db}, nil
}

func (dc *dbCache) get(subID string, period string) (armcostmanagement.QueryResult, bool) {
	var fetchedAt time.Time
	err := dc.db.QueryRow("SELECT fetched_at FROM costs WHERE subscription_id = ? AND period = ? LIMIT 1", subID, period).Scan(&fetchedAt)
	if err != nil || time.Since(fetchedAt) > 24*time.Hour {
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

	dc.db.Exec("DELETE FROM costs WHERE subscription_id = ? AND period = ?", subID, period)

	tx, err := dc.db.Begin()
	if err != nil {
		return
	}

	stmt, err := tx.Prepare("INSERT INTO costs (subscription_id, resource_id, resource_group, resource_type, resource_location, cost, period, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		tx.Rollback()
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
			switch v := row[colCost].(type) {
			case float64:
				cost = v
			case float32:
				cost = float64(v)
			case int64:
				cost = float64(v)
			case int:
				cost = float64(v)
			default:
				if s, ok := v.(string); ok {
					fmt.Sscanf(s, "%f", &cost)
				}
			}
		}

		rid := getVal(colId)
		rg := strings.ToLower(getVal(colRg))
		rt := strings.ToLower(getVal(colType))
		rl := normalizeLocation(getVal(colLoc))

		stmt.Exec(subID, rid, rg, rt, rl, cost, period, now)
	}
	tx.Commit()
}

func (dc *dbCache) getTypeDaily(cacheKey string) (dates []map[string]any, types []string, ok bool) {
	var fetchedAt time.Time
	var datesJSON, typesJSON string
	err := dc.db.QueryRow("SELECT fetched_at, dates, types FROM cost_type_daily WHERE cache_key = ?", cacheKey).Scan(&fetchedAt, &datesJSON, &typesJSON)
	if err != nil || time.Since(fetchedAt) > 6*time.Hour {
		return nil, nil, false
	}
	json.Unmarshal([]byte(datesJSON), &dates)
	json.Unmarshal([]byte(typesJSON), &types)
	return dates, types, true
}

func (dc *dbCache) setTypeDaily(cacheKey string, dates []map[string]any, types []string) {
	now := time.Now()
	datesJSON, _ := json.Marshal(dates)
	typesJSON, _ := json.Marshal(types)
	dc.db.Exec("DELETE FROM cost_type_daily WHERE cache_key = ?", cacheKey)
	dc.db.Exec("INSERT INTO cost_type_daily (cache_key, dates, types, fetched_at) VALUES (?, ?, ?, ?)",
		cacheKey, string(datesJSON), string(typesJSON), now)
}

func recordResourceChanges(db *sql.DB, newResources []AzureResource) {
	now := time.Now()
	rows, err := db.Query("SELECT id, name, type, location, subscription_id, resource_group, tags, status FROM resources")
	if err != nil {
		return
	}

	oldMap := make(map[string]AzureResource)
	for rows.Next() {
		var r AzureResource
		var tagsJSON string
		if err := rows.Scan(&r.ID, &r.Name, &r.Type, &r.Location, &r.SubscriptionID, &r.ResourceGroup, &tagsJSON, &r.Status); err == nil {
			if tagsJSON != "" {
				json.Unmarshal([]byte(tagsJSON), &r.Tags)
			}
			oldMap[r.ID] = r
		}
	}
	rows.Close()

	newMap := make(map[string]AzureResource)
	for _, r := range newResources {
		newMap[r.ID] = r
		if old, exists := oldMap[r.ID]; exists {
			if old.Name != r.Name {
				recordChange(db, r.ID, r.Name, "modified", "name", old.Name, r.Name)
			}
			if old.Status != r.Status {
				recordChange(db, r.ID, r.Name, "modified", "status", old.Status, r.Status)
			}
			if old.Location != r.Location {
				recordChange(db, r.ID, r.Name, "modified", "location", old.Location, r.Location)
			}
			if old.ResourceGroup != r.ResourceGroup {
				recordChange(db, r.ID, r.Name, "modified", "resourceGroup", old.ResourceGroup, r.ResourceGroup)
			}
			if old.Type != r.Type {
				recordChange(db, r.ID, r.Name, "modified", "type", old.Type, r.Type)
			}
			oldTagsJSON, _ := json.Marshal(old.Tags)
			newTagsJSON, _ := json.Marshal(r.Tags)
			if string(oldTagsJSON) != string(newTagsJSON) {
				recordChange(db, r.ID, r.Name, "modified", "tags", string(oldTagsJSON), string(newTagsJSON))
			}
		} else {
			recordChange(db, r.ID, r.Name, "created", "", "", "")
		}
	}

	for id, old := range oldMap {
		if _, exists := newMap[id]; !exists {
			recordChange(db, id, old.Name, "deleted", "", "", "")
		}
	}

	db.Exec("DELETE FROM resources")
	for _, r := range newResources {
		tagsJSON, _ := json.Marshal(r.Tags)
		db.Exec("INSERT OR REPLACE INTO resources (id, name, type, location, subscription_id, resource_group, tags, status, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			r.ID, r.Name, r.Type, r.Location, r.SubscriptionID, r.ResourceGroup, string(tagsJSON), r.Status, now)
	}
}

func recordChange(db *sql.DB, resourceID, resourceName, changeType, field, oldVal, newVal string) {
	db.Exec(`INSERT INTO resource_history (resource_id, resource_name, change_type, field_name, old_value, new_value, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		resourceID, resourceName, changeType, field, oldVal, newVal, time.Now())
}
