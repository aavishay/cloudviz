# CloudViz Roadmap

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

## v0.2.0 - Enhanced Analytics

### Backend
- [x] Cost anomaly detection (flag unusual spikes/drops) — z-score + ratio-based dual detection
- [ ] Budget alerts configuration (threshold-based notifications)
- [ ] Resource dependency mapping (invoke diagram)
- [x] Historical cost trend analysis (30/60/90 day views)
- [ ] Multi-subscription aggregated views
- [ ] Cost forecasting with confidence intervals

### Frontend
- [ ] Interactive cost breakdown by service type (pie/donut chart drill-down)
- [ ] Resource timeline view (created/deleted over time)
- [x] Cost trend charts with zoom/pan — drag-to-zoom + Brush navigator
- [x] Filter presets (save/load custom filter combinations)
- [ ] Dark mode improvements (system preference sync)
- [ ] Keyboard shortcuts for power users

---

## v0.3.0 - Automation & Integration

### Backend
- [ ] Scheduled cost reports (email via SendGrid/AWS SES)
- [ ] Azure Advisor integration for recommendations
- [ ] Webhook notifications for budget alerts
- [ ] Kubernetes cost attribution (Azure Kubernetes Service)
- [ ] Azure Reserved Instance coverage analysis
- [ ] Multi-cloud support (AWS, GCP - foundation)

### Frontend
- [ ] Report scheduling UI
- [x] Alert configuration panel
- [x] Dashboard customization (drag-and-drop cards)
- [x] Export to Excel format
- [x] Shared dashboard links (read-only)

---

## v0.4.0 - Enterprise Features

### Backend
- [ ] Role-based access control (RBAC)
- [ ] Azure AD authentication
- [ ] Audit logging (who viewed/changed what)
- [ ] Resource tagging enforcement policies
- [ ] Cost allocation (chargeback reports)
- [ ] SLA monitoring (resource uptime tracking)

### Frontend
- [ ] User management panel
- [ ] Audit log viewer
- [ ] Cost allocation editor
- [ ] Multi-tenant support
- [ ] SSO login flow

---

## Future Considerations

- Terraform/Ansible state import for infrastructure comparison
- Carbon footprint estimation (green cloud)
- Machine learning-based anomaly detection
- Natural language cost queries (AI assistant)
- Mobile companion app
