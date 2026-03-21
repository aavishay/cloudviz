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

- **Entry point**: `backend/main.go` (single-file server, ~960 lines)
- **Framework**: Gin web framework
- **Authentication**: Azure Default Credential via `azidentity`
- **Data sources**:
  - Azure Resource Graph (ARG) for resource inventory
  - Azure Cost Management API for billing data
  - Azure Monitor API for metrics
- **Database**: SQLite (`cloudviz.db`) for cost caching with 6-hour TTL
- **Key dependencies**: `github.com/gin-gonic/gin`, Azure SDKs (`armcostmanagement`, `armresourcegraph`, `armmonitor`)

**API Endpoints**:
- `GET /api/resources` - Paginated resource list with filtering/sorting
- `GET /api/filters` - Unique values for filter dropdowns
- `GET /api/costs` - Cost data for subscriptions
- `GET /api/costs/stream` - SSE streaming for cost updates
- `GET /api/export` - CSV export
- `GET /api/ai-insights/:resourceId` - AI recommendations via Ollama
- `DELETE /api/costs/cache` - Clear cost cache
- `GET /ws` - WebSocket ping/pong

### Frontend (React + TypeScript + Vite)

- **Entry point**: `frontend/src/main.tsx` → `frontend/src/App.tsx`
- **Single component architecture**: `App.tsx` contains all UI (~1080 lines)
- **Styling**: Tailwind CSS with CSS custom properties for theming (light/dark mode)
- **State**: React hooks (no external state management)

## Commands

### Backend

```bash
cd backend
go run main.go              # Run development server
go build -o cloudviz-backend main.go  # Build binary
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
3. Frontend proxies API calls to `localhost:8080` (hardcoded in App.tsx)

## Key Implementation Details

### Cost Data Caching

- SQLite database (`cloudviz.db`) caches cost data per subscription/period
- 6-hour TTL before re-fetching from Azure Cost Management API
- Background sync runs every 2 hours for all discovered subscriptions
- Handles 429 rate limits with progressive backoff (up to 6 retries)

### Location Normalization

Azure Cost Management and Resource Graph use different location naming conventions. The `normalizeLocation()` function maps these (e.g., `"EU West"` → `"westeurope"`).

### Resource Optimization Scoring

Backend assigns efficiency scores (0-100) based on heuristics:
- VMs with "dev"/"test" in name: score 45, tagged as "Dev Resource"
- Scale sets: score 75
- Unattached disks: score 20, marked as orphaned
- Unattached NICs: score 25, marked as orphaned
- Unassigned public IPs: score 30, marked as orphaned

### Frontend Filter Architecture

- Multi-select filters for region, subscription, resource group
- Single-select for resource type
- Special "orphaned resources only" toggle
- Debounced search (500ms) on name/type/resource group

### AI Insights Integration

- Calls Ollama at `localhost:11434` with Llama 3 model
- Falls back to static recommendation if Ollama is unavailable
- Fetches 7-day CPU/memory metrics from Azure Monitor

## Required Azure Permissions

The application requires the following Azure permissions:
- `Microsoft.ResourceGraph/resources/action` - Query resources
- `Microsoft.CostManagement/query/action` - Cost data
- `Microsoft.Insights/metrics/read` - Monitor metrics