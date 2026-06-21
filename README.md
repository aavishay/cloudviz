<div align="center">

# CloudViz

**Self-hosted Azure infrastructure visualization and cost management — in a single binary.**

[![Version](https://img.shields.io/badge/version-v2.1.6-brightgreen)](https://github.com/aavishay/cloudviz/releases)
[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://go.dev)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](https://github.com/aavishay/cloudviz/releases)

CloudViz gives engineering and FinOps teams a real-time, unified view of Azure resources and costs — without sending data to a third party. Install it in seconds, point it at your Azure tenant, and get immediate visibility across dozens of subscriptions.

</div>

---

## Screenshots

> Screenshots coming soon. A demo GIF and feature walkthrough will be added in an upcoming release.

---

## Why CloudViz?

Most Azure cost tools are either locked inside the Azure Portal (slow, hard to share), expensive SaaS products that require you to export your billing data to a third party, or dashboards that only work at the subscription level.

CloudViz is different:

- **Self-hosted and open source** — your data never leaves your environment
- **Single binary** — no Docker, no Kubernetes, no config files required
- **Multi-subscription by design** — built to handle enterprise tenants with dozens or hundreds of subscriptions in parallel
- **Developer-first** — install via Homebrew, authenticate with `az login`, done

---

## Features

### Cost Intelligence

| Feature | Description |
|---|---|
| Real-time cost streaming | SSE-based progressive loading across all subscriptions simultaneously |
| Month-over-Month comparison | Side-by-side cost deltas with a "Biggest Changes" breakdown by resource group |
| Cost Forecast | Actual spend + AI-powered projected spend for the current month via Azure Forecast API |
| Cost anomaly detection | Z-score and ratio-based methods to flag unexpected spend spikes |
| Subscription comparisons | Compare any subscription vs subscription, or resource group vs resource group |
| Azure Commitments tracking | Reserved Instances and Savings Plans coverage visibility |

### Resource Inventory

| Feature | Description |
|---|---|
| Full resource graph | Powered by Azure Resource Graph — 11,000+ resources queried in seconds |
| Orphaned resource detection | Automatically surfaces unattached disks, NICs, and public IPs |
| Optimization scoring | Every resource receives a 0–100 efficiency score |
| AI insights | Per-resource recommendations via Ollama/Llama 3, with a static fallback |
| Dependency graph | Visual map of how resources relate to each other |
| History tracking | Resource change log over time |

### Operations

| Feature | Description |
|---|---|
| Waste analysis | Stopped VMs, orphaned resources, and underutilized assets in one view |
| Budget alerts | Configurable thresholds with webhook notifications |
| Export | CSV, PDF, and raw cost data export |
| Dark / light mode | Full theme support |
| CLI | `cloudviz serve`, `cloudviz costs`, `cloudviz resources`, `cloudviz cache` |

---

## Quick Start

### Install via Homebrew (recommended)

```bash
brew tap aavishay/cloudviz
brew install cloudviz
```

Authenticate with Azure, then start the server:

```bash
az login
cloudviz serve
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

### Build from Source

Requires Go 1.21+ and Node.js 18+.

```bash
git clone https://github.com/aavishay/cloudviz.git
cd cloudviz

# Build the frontend and embed it into the binary
cd frontend && npm install && npm run build
cp -r dist ../backend/dist

cd ../backend
go build -o cloudviz main.go azure.go db.go types.go dependencies.go webhooks.go

./cloudviz serve
```

---

## CLI Reference

```
cloudviz serve              Start the web server (default: http://localhost:8080)
cloudviz costs              Print cost summary to stdout
cloudviz resources          List resources to stdout
cloudviz cache              Manage the local SQLite cost cache
```

Run `cloudviz --help` for the full list of flags and subcommands.

---

## Architecture

```
cloudviz (single binary)
├── Go + Gin HTTP server         — REST API + SSE streaming
├── embedded React SPA           — served from /
├── SQLite (cloudviz.db)         — local cost cache with 6-hour TTL
└── Azure SDK clients
    ├── armresourcegraph         — resource inventory
    ├── armcostmanagement        — billing data + forecasts
    └── armmonitor               — CPU/memory metrics for AI insights
```

**Authentication** uses [Azure Default Credential](https://learn.microsoft.com/en-us/azure/developer/go/azure-sdk-authentication), which picks up `az login`, environment variables, managed identity, and workload identity automatically — no additional configuration needed.

**Cost data** is fetched from Azure Cost Management, cached in a local SQLite database, and streamed to the browser via Server-Sent Events. Background sync runs every 2 hours across all discovered subscriptions. Rate limiting (2 req/s, burst 5) prevents 429 responses from the Azure Cost Management API.

**Frontend** is a single-page React 18 application built with Vite, Tailwind CSS, and Recharts. It is embedded directly into the Go binary at compile time via `go:embed`, so no separate static file server is needed.

---

## Required Azure Permissions

CloudViz requires the following permissions on the subscriptions or management groups you want to monitor:

| Permission | Purpose |
|---|---|
| `Microsoft.ResourceGraph/resources/action` | Query resource inventory |
| `Microsoft.CostManagement/query/action` | Fetch cost and billing data |
| `Microsoft.CostManagement/forecast/action` | Generate cost forecasts |
| `Microsoft.Insights/metrics/read` | Read CPU/memory metrics for AI insights |

The built-in **Reader** role covers all of these permissions.

---

## Tech Stack

**Backend**

- [Go 1.21+](https://go.dev) with [Gin](https://gin-gonic.com)
- [Azure SDK for Go](https://github.com/Azure/azure-sdk-for-go) (`armcostmanagement`, `armresourcegraph`, `armmonitor`)
- [SQLite](https://www.sqlite.org) via `glebarez/go-sqlite` (no CGo required)
- [Cobra](https://github.com/spf13/cobra) for the CLI
- [golang.org/x/time/rate](https://pkg.go.dev/golang.org/x/time/rate) for rate limiting

**Frontend**

- [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev) for bundling
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Recharts](https://recharts.org) for data visualization

**Distribution**

- Single binary with embedded frontend assets (`go:embed`)
- [Homebrew tap](https://github.com/aavishay/homebrew-cloudviz) for macOS and Linux
- Pre-built releases: `darwin/arm64`, `darwin/amd64`, `linux/amd64`

---

## Supported Platforms

| Platform | Architecture | Status |
|---|---|---|
| macOS | arm64 (Apple Silicon) | Supported |
| macOS | amd64 (Intel) | Supported |
| Linux | amd64 | Supported |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes
4. Open a pull request

---

## License

[AGPL-3.0](LICENSE) — free to use and modify; if you run a modified version as a network service, you must make the source available.

---

<div align="center">

Built with Go and React. Designed for Azure at scale.

</div>
