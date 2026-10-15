# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CloudViz is an Azure cloud infrastructure visualization and cost management dashboard. It provides a unified view of Azure resources, costs, and AI-powered optimization recommendations.

## Architecture

This is a monorepo with two main components:

```
cloudviz/
├── backend/        # Go API server (port 8080)
└── frontend/       # React + Vite + Tailwind SPA
```

### Backend (Go + Gin)

- **Entry point**: `backend/main.go`
- **Structure**: Multi-file Go project (`main.go`, `azure.go`, `db.go`, `types.go`, `dependencies.go`, `webhooks.go`)
- **Framework**: Gin web framework
- **Frontend Embedding**: Frontend assets are embedded in the binary via `go:embed dist`
- **Authentication**: Azure Default Credential via `azidentity`
- **Data sources**:
  - Azure Resource Graph (ARG) for resource inventory
  - Azure Cost Management API for billing data
  - Azure Monitor API for metrics
- **Database**: SQLite at `~/.cloudviz/cloudviz.db` (override with `--db` or `$CLOUDVIZ_DB`); caches costs, the resource inventory and change history. Versions before 2.1.16 used `cloudviz.db` in the working directory; it is copied over on first start.
- **Network**: listens on `127.0.0.1` and `::1` only; `localRequestGuard` rejects non-loopback `Host` headers, foreign origins, cross-site requests and non-JSON request bodies.
- **Key dependencies**: `github.com/gin-gonic/gin`, Azure SDKs (`armcostmanagement`, `armresourcegraph`, `armmonitor`)

**API Endpoints**:
- `GET /api/resources` - Resource list from the in-memory inventory, with filtering/sorting (all matches; `unallocatedCost` when unfiltered)
- `GET /api/filters` - Unique values for filter dropdowns (subscriptions include `state`, disabled ones too)
- `GET /api/subscriptions` - Active subscriptions (`?includeDisabled=true` for all)
- `GET /api/costs/stream` - SSE: cached costs immediately, then results from the cost sync worker
- `GET /api/costs/daily`, `/api/costs/comparison`, `/api/costs/forecast` - Daily trend, coverage-aware period comparison, month-end forecast
- `GET /api/export` - CSV export
- `GET /api/ai-insights?id=<resource ID>` - AI recommendations via Ollama (rule-based fallback)
- `GET /api/dependencies?id=<resource ID>` - Dependency graph for a resource
- `POST /api/inventory/refresh` - Rescan the resource inventory in the background
- `DELETE /api/costs/cache` - Clear cost cache

### Frontend (React + TypeScript + Vite)

- **Entry point**: `frontend/src/main.tsx` → `frontend/src/App.tsx`
- **Mostly one component**: `App.tsx` holds most UI and state (~6.7k lines); `components/` has the sidebar, resource table, history/waste views, modals and helpers (`csv.ts`, `env.ts`, `storage.ts`)
- **API calls**: relative `/api/...` paths (served by the backend in production, proxied by Vite in development)
- **Styling**: Tailwind CSS with CSS custom properties for theming (light/dark mode)
- **State**: React hooks (no external state management)

## Commands

### Backend

```bash
cd backend
go run main.go azure.go db.go types.go dependencies.go webhooks.go serve  # Run development server
go build -o cloudviz main.go azure.go db.go types.go dependencies.go webhooks.go # Build unified binary
go test ./...                                                              # Tests (includes router-level handler tests)
cloudviz cache prune-history --all                                         # Clear change history and compact the DB (server stopped)
```

### Unified Build (Frontend + Backend)
```bash
cd frontend && npm run build
cp -r frontend/dist backend/dist
cd backend && go build -o cloudviz main.go azure.go db.go types.go dependencies.go webhooks.go
```

### Frontend

```bash
cd frontend
npm install                 # Install dependencies
npm run dev                 # Start dev server (Vite)
npm run build               # Build for production (TypeScript check + Vite build)
npm run lint                # Run ESLint
npm run preview             # Preview production build
```

## Development Workflow

1. Start the backend first (requires Azure credentials via `az login` or environment)
2. Start the frontend dev server
3. The Vite dev server proxies `/api` to `localhost:8080`

## Key Implementation Details

### Cost Data Caching

- SQLite caches cost data per subscription/period; `cost_fetches` records every fetch (including empty results, i.e. $0) and `daily_fetches` the window each sub's daily costs cover
- A single server-side cost sync worker (`costSync`) fetches subscriptions one at a time from a deduplicated queue (uncached first), at startup and every 30 minutes for subs older than 6 hours; SSE streams only forward its results
- Cost Management results are paged via `nextLink` (5,000 rows per page)
- The tenant limit of 20 calls/min is split between `costLimiter` (14/min) and `forecastLimiter` (6/min); a wait that would overrun its deadline fails the call instead of sending it unthrottled
- Read-only endpoints serve cached rows whatever their age (`getCachedDailyCosts`); staleness only decides what to refetch

### Resource Inventory

- The inventory is held in memory (`getInventory`), loaded from the `resources` table at startup and rescanned from Resource Graph every 15 minutes (`runInventorySnapshots`)
- Requests filter it in Go (`filterResources`) and attach costs per request (`attachCosts`); no request queries Resource Graph for the resource list
- Change history (`resource_history`) is recorded only from those full snapshots; a scan that drops >20% of resources is held until a second scan confirms it
- Changes to AKS/Karpenter-managed resources are flagged `is_system` and hidden from History by default

### Location Normalization

Azure Cost Management and Resource Graph use different location naming conventions. The `normalizeLocation()` function maps these (e.g., `"EU West"` → `"westeurope"`).

### Resource Optimization Scoring

Backend assigns efficiency scores (0-100) based on heuristics:
- VMs with "dev"/"test" in name: score 45, tagged as "Dev Resource"
- Scale sets: score 75
- Unattached disks: score 20, marked as orphaned
- Unattached NICs (no VM, private endpoint or private link service): score 25, marked as orphaned
- Unassigned public IPs (no IP configuration or NAT gateway): score 30, marked as orphaned
- `orphanKind` and the `kqlUnattached*` predicates are the single definition of orphans

### Frontend Filter Architecture

- Multi-select filters for region, subscription, resource group
- Single-select for resource type
- Special "orphaned resources only" toggle
- Debounced search (500ms) on name/type/resource group

### AI Insights Integration

- Calls Ollama at `localhost:11434` with Llama 3 model
- Falls back to a rule-based recommendation if Ollama is unavailable
- Fetches 7-day metrics from Azure Monitor (platform metric names, e.g. `Available Memory Percentage`; timespans in UTC via `monitorTimespan`)

### Security Notes

- Values embedded in KQL go through `kqlQuote`; resource IDs are validated with `isValidResourceID`
- Webhook delivery (`newWebhookClient`) refuses internal addresses at connect time and doesn't follow redirects
- CSV exports neutralize spreadsheet formulas (`csvSafe` in Go, `csvCell` in the frontend)

## Required Azure Permissions

The application requires the following Azure permissions:
- `Microsoft.ResourceGraph/resources/action` - Query resources
- `Microsoft.CostManagement/query/action` - Cost data
- `Microsoft.Insights/metrics/read` - Monitor metrics