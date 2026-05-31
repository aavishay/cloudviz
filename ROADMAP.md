# CloudViz Roadmap

> **Legend:** ✅ Released | 🚧 In Progress | 📝 Planned | 🔮 Future Consideration | `[x]` Complete | `[ ]` Not Started

---

**Current Version**: `1.34.0` (May 2026) · [GitHub Releases](https://github.com/avishay/cloudviz/releases)

## 🎉 Recently Completed

### v1.34.0 (May 2026)
- [x] Backend compilation fix for Go 1.26 + React lint fixes across frontend components

### v1.33.0 (May 2026)
- [x] Major frontend refactor — extracted monolithic `App.tsx` into 22 component/hook files
- [x] Design system with animations, typography, and color tokens

### v1.32.0–v1.32.2 (May 2026)
- [x] Dashboard sync stall fix — SSE error handling + reduced global 429 cooldown
- [x] Optimized subscription cost loading speed

### v1.31.0 (April 2026)
- [x] Commitments tab — RI and Savings Plan purchase tracking
- [x] Cost display in Dependency Graph — Show cost per dependency/dependent resource
- [x] Null safety improvements — Fixed dependents/dependencies null handling
- [x] Clickable History items — Navigate to resources from history, handle deleted resources
- [x] Sortable Cost Details table — Persistent column sorting

### v1.30.0 (April 2026)
- [x] Configurable cost anomaly detection parameters
- [x] Stopped VM detection in waste analysis

### v1.29.0 (April 2026)
- [x] Orphaned disk detection via Azure `managedBy` field
- [x] Subscription auto-discovery + improved anomaly detection

### Code Quality & Performance
- [x] Backend code simplification — Consolidated 6 duplicate metrics fetchers
- [x] Error handling improvements — Fixed silent error handlers across codebase
- [x] Performance optimizations — Cached Azure Metrics clients, batch DB operations
- [x] Frontend efficiency — Memoized expensive calculations, removed invalid hook dependencies
- [x] Utility functions — Added `truncateString`, `parseFloatVal`, `parseAzureDate` helpers

---

## v0.1.x — Core (shipped as v1.17.0–v1.22.0)

- [x] Azure Resource Graph integration (resource inventory)
- [x] Azure Cost Management API (billing data)
- [x] Azure Monitor API (metrics)
- [x] SQLite cost caching (6-hour TTL)
- [x] Multi-select filters (region, subscription, resource group)
- [x] Resource optimization scoring
- [x] AI insights via Ollama (Llama 3)
- [x] CSV export
- [x] PDF export (jspdf)
- [x] Daily cost trends
- [x] Cost comparison (current vs previous period)
- [x] Tag-based resource filtering
- [x] Orphaned resource detection
- [x] WebSocket ping/pong

---

## v0.2.0 — Enhanced Analytics (shipped as v1.23.0–v1.28.0)

### Backend
- [x] Cost anomaly detection (flag unusual spikes/drops) — z-score + ratio-based dual detection
- [x] Budget alerts configuration (threshold-based notifications) — CRUD API at `/api/budgets` and `/api/alerts`
- [x] Resource dependency mapping — Backend API at `/api/resources/{id}/dependencies` and frontend visualization modal with dependency/dependent list
- [x] Historical cost trend analysis (30/60/90 day views) — `/api/costs/trend`
- [x] Multi-subscription aggregated views — Supported via query arrays
- [x] Cost forecasting — `/api/costs/forecast` with Azure Forecast API

### Frontend
- [x] Interactive cost breakdown by service type (pie/donut chart drill-down) — Cost by Type, Region, Subscription, Environment
- [x] Resource timeline view (created/deleted over time) — History tab with `/api/history`
- [x] Cost trend charts with zoom/pan — drag-to-zoom + Brush navigator
- [x] Filter presets (save/load custom filter combinations)
- [x] Dark mode improvements (system preference sync) — CSS custom properties with auto detection
- [x] Keyboard shortcuts for power users (v1.33.0 — `useKeyboardShortcuts` hook)
- [ ] Keyboard shortcuts help modal (`?` key) — tracked in v0.5.0

---

## v0.3.0 — Automation & Integration (shipped as v1.24.0–v1.31.0)

### Backend
- [x] Azure Advisor integration for recommendations — `/api/advisor/recommendations` (v1.24.0)
- [x] Webhook notifications for budget alerts — Webhook delivery with retries, rate limiting, delivery logging (v1.25.0)
- [x] Azure Reserved Instance coverage analysis — `/api/commitment/savings` (v1.31.0)
- [ ] Scheduled cost reports (email via SendGrid/AWS SES) — requires email provider integration
- [ ] Kubernetes cost attribution (AKS) — AKS-specific metrics
- [ ] Multi-cloud support (AWS/GCP) — foundation work

### Frontend
- [x] Alert configuration panel — Budgets and alerts management UI (v1.25.0)
- [x] Dashboard customization (drag-and-drop cards) — Full drag-and-drop with persistence (v1.26.0)
- [x] Export to Excel format — CSV export with Excel compatibility (v1.26.0)
- [x] Shared dashboard links (read-only) — URL-based filter sharing (v1.27.0)
- [x] Cost display in Dependency Graph — Show cost per resource in dependency view (v1.31.0)
- [x] Clickable History items — Navigate to resources from history tab (v1.31.0)
- [ ] Report scheduling UI — blocked by email provider integration

---

## v0.4.0 — Enterprise Features (shipped as v1.26.0–v1.32.0)

### Backend
- [x] Cost allocation (chargeback reports) — Cost by subscription/environment available
- [x] SLA monitoring (resource uptime tracking) — `/api/sla` endpoint with VmAvailabilityMetric + CPU fallback, dashboard panel showing uptime % and downtime hours
- [x] PII masking for external reports — `?mask=true` param on `/api/resources` and `/api/export`, settings toggle with localStorage persistence, replaces names with `resource-001`, RG/sub with `masked-rg`/`masked-sub`

### Frontend
- [x] Virtual scrolling for large tables — Support 10k+ resources with react-window
- [x] Theme transition animations — Smooth dark/light mode switching — CSS transitions on `body, body *` for background, border, color, and box-shadow

---

## v0.5.0 - Platform Expansion 📝 Planned

### Backend
- [ ] REST API versioning (v1, v2)
- [ ] GraphQL endpoint for flexible queries
- [ ] Real-time WebSocket updates (expand beyond ping/pong)
- [ ] Database migration system (currently manual)
- [ ] Plugin architecture for custom cost sources
- [ ] Rate limiting per user/API key
- [ ] Redis caching option — For multi-user deployments
- [ ] Server-side pagination — Reduce memory for large subscriptions

### Frontend
- [ ] Mobile-responsive design overhaul
- [ ] Progressive Web App (PWA) support
- [ ] Offline mode with local data caching
- [ ] Advanced query builder for custom reports
- [ ] Custom dashboard widget SDK
- [ ] Keyboard shortcuts help modal — `?` key for shortcut discovery
- [x] Component extraction — Split App.tsx into separate component files ✅ (v1.33.0)

---

## Future Considerations 🔮

### Near-term (6-12 months)
- [ ] Terraform/Ansible state import for infrastructure comparison
- [ ] Carbon footprint estimation (green cloud) — Azure Sustainability API integration
- [x] Enhanced ML-based anomaly detection — Build on existing z-score implementation — ✅ **COMPLETED**
  - Backend: `/api/costs/anomalies/enhanced` with Isolation Forest, MAD, Seasonal algorithms
  - Frontend: Dashboard panel showing severity badges (Critical/High/Medium/Low) with method indicators
  - Features: Combined scoring, trend analysis, day-of-week patterns
- [ ] Natural language cost queries — Expand existing Ollama integration
- [ ] Cost anomaly alerts with severity levels — Statistical analysis with standard deviation
- [ ] Bulk tag editor — Mass update resources missing required tags
- [ ] Tag compliance scoring — Track Environment, Owner, Project tag coverage

### Quick Wins (High Impact, Low Effort)
- [x] Copy resource ID button — For Azure CLI/PowerShell usage — ✅ **COMPLETED** — Button in resource table and AI Insights modal with full ID display
- [x] Resource count badge on tabs — Show (25) next to "Resources" — ✅ **COMPLETED** — Shows count on Resources and History tabs with active/inactive styling
- [x] Search/filter within dependency graph — For long dependency lists — ✅ **COMPLETED** — Search by name, type, or relationship; shows filtered count
- [x] Export dependency graph as PNG/SVG — Share architecture diagrams — ✅ **COMPLETED** — Export buttons generate SVG with radial layout, connections, and legend; PNG uses 2x high-res canvas rendering
- [x] Resource favorites/pinning — Quick access to important resources — ✅ **COMPLETED** — Star button on each resource row, Favorites Only quick filter, persisted to localStorage with favorites count badge
- [x] Cost per day toggle — More granular cost view option — ✅ **COMPLETED** — Toggle in Settings to show daily cost (divided by 30) instead of monthly; updates Total Cost display and all cost cards
- [x] Bulk selection actions — Multi-select for export/tagging — ✅ **COMPLETED** — Checkbox column, select all/none with indeterminate state, bulk actions bar with count and Export CSV button

### Long-term (12+ months)
- [ ] Mobile companion app (React Native/Flutter)
- [ ] Multi-cloud support (AWS Cost Explorer, GCP Billing API)
- [ ] Marketplace integrations (GitHub, GitLab CI cost attribution)
- [ ] Custom ML models for cost prediction
- [ ] Blockchain-based cost verification (enterprise audit)

---

## Contributing

When adding new features, please:
1. Mark completed items with `[x]`
2. Add release dates to version headers
3. Move items between sections as priorities change
4. Link PRs/issues where applicable
