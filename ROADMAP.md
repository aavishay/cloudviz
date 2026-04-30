# CloudViz Roadmap

> **Legend:** ✅ Released | 🚧 In Progress | 📝 Planned | 🔮 Future Consideration | `[x]` Complete | `[ ]` Not Started

---

## 🎉 Recently Completed

### v1.2.0 (April 2026)
- [x] Cost display in Dependency Graph — Show cost per dependency/dependent resource
- [x] Null safety improvements — Fixed dependents/dependencies null handling
- [x] Clickable History items — Navigate to resources from history, handle deleted resources
- [x] Sortable Cost Details table — Persistent column sorting
- [x] Clickable dashboard elements — Environment bars, history items

### Code Quality & Performance (2024)
- [x] Backend code simplification — Consolidated 6 duplicate metrics fetchers
- [x] Error handling improvements — Fixed silent error handlers across codebase
- [x] Performance optimizations — Cached Azure Metrics clients, batch DB operations
- [x] Frontend efficiency — Memoized expensive calculations, removed invalid hook dependencies
- [x] Utility functions — Added `truncateString`, `parseFloatVal`, `parseAzureDate` helpers

---

## v0.1.x - Current Release

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

## v0.2.0 - Enhanced Analytics ✅ Released

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
- [ ] Keyboard shortcuts for power users

---

## v0.3.0 - Automation & Integration ✅ Released

### Backend
- [ ] Scheduled cost reports (email via SendGrid/AWS SES) — TODO: Requires email provider integration
- [x] Azure Advisor integration for recommendations — `/api/advisor/recommendations`
- [x] Webhook notifications for budget alerts — Webhook delivery system with retries, rate limiting, and delivery logging
- [ ] Kubernetes cost attribution (Azure Kubernetes Service) — TODO: AKS-specific metrics
- [x] Azure Reserved Instance coverage analysis — `/api/commitment/savings`
- [ ] Multi-cloud support (AWS, GCP - foundation) — TODO: Major feature

### Frontend
- [ ] Report scheduling UI — Blocked by backend email service
- [x] Alert configuration panel — Budgets and alerts management UI
- [x] Dashboard customization (drag-and-drop cards) — Full drag-and-drop with persistence
- [x] Export to Excel format — CSV export with Excel compatibility
- [x] Shared dashboard links (read-only) — URL-based filter sharing
- [x] Cost display in Dependency Graph — Show cost per resource in dependency view
- [x] Clickable History items — Navigate to resources from history tab

---

## v0.4.0 - Enterprise Features 🚧 In Progress

### Backend
- [ ] Role-based access control (RBAC) — Foundation: resource history tracking exists
- [ ] Azure AD authentication — Replace current DefaultAzureCredential
- [ ] Audit logging (who viewed/changed what) — Foundation: `/api/history` endpoint exists
- [ ] Resource tagging enforcement policies — Foundation: tag-based filtering exists
- [x] Cost allocation (chargeback reports) — Cost by subscription/environment available
- [ ] SLA monitoring (resource uptime tracking) — VM metrics collection exists
- [ ] PII masking for external reports — Mask resource names in exports/screenshots

### Frontend
- [ ] User management panel
- [ ] Audit log viewer — Foundation: History tab exists
- [ ] Cost allocation editor
- [ ] Multi-tenant support
- [ ] SSO login flow
- [ ] Virtual scrolling for large tables — Support 10k+ resources with react-window
- [ ] Theme transition animations — Smooth dark/light mode switching

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
- [ ] Component extraction — Split App.tsx into separate files

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
- [ ] Resource count badge on tabs — Show (25) next to "Resources"
- [ ] Search/filter within dependency graph — For long dependency lists
- [ ] Export dependency graph as PNG/SVG — Share architecture diagrams
- [ ] Resource favorites/pinning — Quick access to important resources
- [ ] Cost per day toggle — More granular cost view option
- [ ] Bulk selection actions — Multi-select for export/tagging

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
