# CloudViz

CloudViz is a unified Azure resource and cost management tool. It provides a real-time dashboard to monitor your Azure infrastructure, analyze costs, and identify optimization opportunities.

## Features
- **Real-time Cost Tracking**: Stream live cost updates from Azure Cost Management.
- **Resource Insights**: View detailed metrics and AI-driven recommendations for resource optimization.
- **Unified CLI**: A single binary that serves both the backend API and the frontend UI.
- **Data Caching**: Local SQLite cache for fast data retrieval and history tracking.

## Getting Started

### Prerequisites
- [Go](https://golang.org/doc/install) (for backend)
- [Node.js](https://nodejs.org/) (for frontend)
- Azure CLI or credentials configured in your environment.

### Running the Unified Application
The easiest way to run CloudViz is via the unified CLI binary:

1. **Build the shared binary**:
   ```bash
   # From the root directory
   cd frontend && npm install && npm run build
   cd ../backend && cp -r ../frontend/dist ./dist
   go build -o cloudviz main.go azure.go db.go types.go
   ```

2. **Start the server**:
   ```bash
   ./cloudviz serve
   ```

3. **Access the UI**:
   Open [http://localhost:8080](http://localhost:8080) in your browser.

## CLI Usage
The `cloudviz` binary also supports CLI commands for resource and cost inspection:

- `cloudviz resources --orphaned`: List orphaned resources only.
- `cloudviz resources --unattached-disk`: List unattached disks only.
- `cloudviz resources --unassigned-pip`: List unassigned public IPs only.
- `cloudviz resources --unattached-nic`: List unattached network interfaces only.
- `cloudviz costs --sub <subscription_id>`: Show cost breakdown for a specific subscription.
- `cloudviz cache clear`: Clear the local cost cache.

## Project Structure
- `backend/`: Go source code for the API server and CLI tool.
- `frontend/`: React/Vite application for the web dashboard.
- `backend/dist/`: Embedded frontend assets (built from `frontend/`).
