package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/resourcegraph/armresourcegraph"
	"github.com/gin-gonic/gin"
)

// DependencyType represents the type of relationship between resources
type DependencyType string

const (
	DependencyNetwork   DependencyType = "network"     // NIC to VM, NSG to subnet
	DependencyStorage   DependencyType = "storage"     // Disk to VM
	DependencyParent    DependencyType = "parent"      // Resource to resource group
	DependencyReference DependencyType = "reference"   // Generic reference (tags, config)
	DependencyIdentity  DependencyType = "identity"    // Managed identity
)

// ResourceDependency represents a dependency relationship
type ResourceDependency struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Type         string         `json:"type"`
	Relationship DependencyType `json:"relationship"`
	Direction    string         `json:"direction"` // "inbound" or "outbound"
	Properties   map[string]any `json:"properties,omitempty"`
}

// ResourceDependencyGraph represents the full dependency graph for a resource
type ResourceDependencyGraph struct {
	ResourceID    string               `json:"resourceId"`
	ResourceName  string               `json:"resourceName"`
	ResourceType  string               `json:"resourceType"`
	Dependencies  []ResourceDependency `json:"dependencies"`  // Resources this resource depends on
	Dependents    []ResourceDependency `json:"dependents"`    // Resources that depend on this
	Relationships int                  `json:"relationships"` // Total count
	GeneratedAt   time.Time            `json:"generatedAt"`
}

// DependencyAnalyzer analyzes resource dependencies
type DependencyAnalyzer struct {
	db        *sql.DB
	argClient *armresourcegraph.Client
}

// NewDependencyAnalyzer creates a new dependency analyzer
func NewDependencyAnalyzer(db *sql.DB, argClient *armresourcegraph.Client) *DependencyAnalyzer {
	return &DependencyAnalyzer{
		db:        db,
		argClient: argClient,
	}
}

// ResourceInfo holds basic resource information
type ResourceInfo struct {
	Name           string
	Type           string
	SubscriptionID string
	ResourceGroup  string
}

// queryResourceFromARG queries Azure Resource Graph for resource details
func (da *DependencyAnalyzer) queryResourceFromARG(ctx context.Context, resourceID string) (*ResourceInfo, error) {
	// Extract subscription ID from resource ID
	parts := strings.Split(resourceID, "/")
	var subID string
	for i, p := range parts {
		if strings.EqualFold(p, "subscriptions") && i+1 < len(parts) {
			subID = parts[i+1]
			break
		}
	}
	if subID == "" {
		return nil, fmt.Errorf("could not extract subscription ID from resource ID")
	}

	query := fmt.Sprintf(`
		resources
		| where id == "%s"
		| project name, type, subscriptionId, resourceGroup
	`, resourceID)

	result, err := da.argClient.Resources(ctx, armresourcegraph.QueryRequest{
		Subscriptions: []*string{&[]string{subID}[0]},
		Query:         &query,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to query ARG: %w", err)
	}

	if result.Data == nil {
		return nil, fmt.Errorf("resource not found in Azure")
	}

	// Parse results
	data, ok := result.Data.([]interface{})
	if !ok || len(data) == 0 {
		return nil, fmt.Errorf("resource not found in Azure")
	}

	row, ok := data[0].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected response format")
	}

	return &ResourceInfo{
		Name:           getStringValue(row, "name"),
		Type:           getStringValue(row, "type"),
		SubscriptionID: getStringValue(row, "subscriptionId"),
		ResourceGroup:  getStringValue(row, "resourceGroup"),
	}, nil
}

// getStringValue extracts a string value from a map
func getStringValue(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// AnalyzeDependencies analyzes dependencies for a resource
func (da *DependencyAnalyzer) AnalyzeDependencies(ctx context.Context, resourceID string) (*ResourceDependencyGraph, error) {
	// Get resource details from database or Azure
	var resourceName, resourceType, subscriptionID, resourceGroup string
	err := da.db.QueryRow(`
		SELECT name, type, subscription_id, resource_group
		FROM resources
		WHERE id = ?
	`, resourceID).Scan(&resourceName, &resourceType, &subscriptionID, &resourceGroup)
	if err != nil {
		// Resource not in cache, query from Azure Resource Graph
		resourceData, queryErr := da.queryResourceFromARG(ctx, resourceID)
		if queryErr != nil {
			return nil, fmt.Errorf("resource not found: %w", queryErr)
		}
		resourceName = resourceData.Name
		resourceType = resourceData.Type
		subscriptionID = resourceData.SubscriptionID
		resourceGroup = resourceData.ResourceGroup
	}

	graph := &ResourceDependencyGraph{
		ResourceID:   resourceID,
		ResourceName: resourceName,
		ResourceType: resourceType,
		GeneratedAt:  time.Now().UTC(),
	}

	// Analyze based on resource type
	switch {
	case strings.Contains(resourceType, "microsoft.compute/virtualmachines"):
		da.analyzeVM(ctx, resourceID, subscriptionID, resourceGroup, graph)
	case strings.Contains(resourceType, "microsoft.network/networkinterfaces"):
		da.analyzeNIC(ctx, resourceID, subscriptionID, resourceGroup, graph)
	case strings.Contains(resourceType, "microsoft.compute/disks"):
		da.analyzeDisk(ctx, resourceID, subscriptionID, resourceGroup, graph)
	case strings.Contains(resourceType, "microsoft.network/publicipaddresses"):
		da.analyzePublicIP(ctx, resourceID, subscriptionID, resourceGroup, graph)
	case strings.Contains(resourceType, "microsoft.network/virtualnetworks"):
		da.analyzeVNet(ctx, resourceID, subscriptionID, resourceGroup, graph)
	case strings.Contains(resourceType, "microsoft.storage/storageaccounts"):
		da.analyzeStorageAccount(ctx, resourceID, subscriptionID, resourceGroup, graph)
	default:
		// Generic dependency analysis using resource group
		da.analyzeGeneric(ctx, resourceID, subscriptionID, resourceGroup, graph)
	}

	graph.Relationships = len(graph.Dependencies) + len(graph.Dependents)
	return graph, nil
}

// analyzeVM analyzes dependencies for a Virtual Machine
func (da *DependencyAnalyzer) analyzeVM(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// VMs depend on: NICs, Disks (OS and data), Resource Group
	// VMs are depended on by: VM extensions, diagnostics

	// Query NICs attached to this VM
	nics, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.network/networkinterfaces"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.virtualMachine.id contains "`+resourceID+`"
		| project id, name, type
	`)
	if err == nil {
		for _, nic := range nics {
			graph.Dependencies = append(graph.Dependencies, ResourceDependency{
				ID:           nic["id"].(string),
				Name:         nic["name"].(string),
				Type:         nic["type"].(string),
				Relationship: DependencyNetwork,
				Direction:    "outbound",
				Properties:   map[string]any{"role": "network-interface"},
			})
		}
	}

	// Query disks attached to this VM
	disks, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.compute/disks"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.diskState == "Attached"
		| where properties.managedBy contains "`+resourceID+`"
		| project id, name, type
	`)
	if err == nil {
		for _, disk := range disks {
			graph.Dependencies = append(graph.Dependencies, ResourceDependency{
				ID:           disk["id"].(string),
				Name:         disk["name"].(string),
				Type:         disk["type"].(string),
				Relationship: DependencyStorage,
				Direction:    "outbound",
				Properties:   map[string]any{"role": "os-disk"},
			})
		}
	}

	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})

	// Find VMs that reference this VM (scale sets, availability sets)
	// This is a simplified analysis - full analysis would require more queries
}

// analyzeNIC analyzes dependencies for a Network Interface
func (da *DependencyAnalyzer) analyzeNIC(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// NICs depend on: VNet/Subnet, NSG, Public IP
	// NICs are depended on by: VMs

	// Query VM attached to this NIC
	vms, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.compute/virtualmachines"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.networkProfile.networkInterfaces contains "`+resourceID+`"
		| project id, name, type
	`)
	if err == nil {
		for _, vm := range vms {
			graph.Dependents = append(graph.Dependents, ResourceDependency{
				ID:           vm["id"].(string),
				Name:         vm["name"].(string),
				Type:         vm["type"].(string),
				Relationship: DependencyNetwork,
				Direction:    "inbound",
				Properties:   map[string]any{"role": "attached-vm"},
			})
		}
	}

	// Query subnet this NIC is in
	subnets, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.network/networkinterfaces"
		| where id == "`+resourceID+`"
		| project subnetId = tostring(properties.ipConfigurations[0].properties.subnet.id)
		| join kind=inner (
			resources
			| where type == "microsoft.network/virtualNetworks"
		) on $left.subnetId == $right.id
		| project id, name, type
	`)
	if err == nil {
		for _, subnet := range subnets {
			graph.Dependencies = append(graph.Dependencies, ResourceDependency{
				ID:           subnet["id"].(string),
				Name:         subnet["name"].(string),
				Type:         subnet["type"].(string),
				Relationship: DependencyNetwork,
				Direction:    "outbound",
				Properties:   map[string]any{"role": "subnet"},
			})
		}
	}

	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})
}

// analyzeDisk analyzes dependencies for a Managed Disk
func (da *DependencyAnalyzer) analyzeDisk(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// Disks depend on: Resource Group
	// Disks are depended on by: VMs

	// Query VM this disk is attached to
	vms, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.compute/virtualmachines"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.storageProfile.osDisk.managedDisk.id == "`+resourceID+`"
			or properties.storageProfile.dataDisks contains (managedDisk: { id: "`+resourceID+`" })
		| project id, name, type
	`)
	if err == nil {
		for _, vm := range vms {
			graph.Dependents = append(graph.Dependents, ResourceDependency{
				ID:           vm["id"].(string),
				Name:         vm["name"].(string),
				Type:         vm["type"].(string),
				Relationship: DependencyStorage,
				Direction:    "inbound",
				Properties:   map[string]any{"role": "attached-vm"},
			})
		}
	}

	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})
}

// analyzePublicIP analyzes dependencies for a Public IP Address
func (da *DependencyAnalyzer) analyzePublicIP(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// Public IPs are depended on by: NICs, Load Balancers, NAT Gateways

	// Query NICs using this public IP
	nics, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.network/networkinterfaces"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.ipConfigurations contains (properties: { publicIPAddress: { id: "`+resourceID+`" } })
		| project id, name, type
	`)
	if err == nil {
		for _, nic := range nics {
			graph.Dependents = append(graph.Dependents, ResourceDependency{
				ID:           nic["id"].(string),
				Name:         nic["name"].(string),
				Type:         nic["type"].(string),
				Relationship: DependencyNetwork,
				Direction:    "inbound",
				Properties:   map[string]any{"role": "attached-nic"},
			})
		}
	}

	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})
}

// analyzeVNet analyzes dependencies for a Virtual Network
func (da *DependencyAnalyzer) analyzeVNet(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// VNets are depended on by: Subnets, NICs, VMs, AKS clusters

	// Query all NICs in this VNet
	nics, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.network/networkinterfaces"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.ipConfigurations contains (properties: { subnet: { id: contains("`+resourceID+`") } })
		| project id, name, type
	`)
	if err == nil {
		for _, nic := range nics {
			graph.Dependents = append(graph.Dependents, ResourceDependency{
				ID:           nic["id"].(string),
				Name:         nic["name"].(string),
				Type:         nic["type"].(string),
				Relationship: DependencyNetwork,
				Direction:    "inbound",
				Properties:   map[string]any{"role": "nic"},
			})
		}
	}

	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})
}

// analyzeStorageAccount analyzes dependencies for a Storage Account
func (da *DependencyAnalyzer) analyzeStorageAccount(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// Storage accounts are depended on by: VMs (boot diagnostics), Function Apps, Logic Apps

	// Query VMs using this storage for boot diagnostics
	vms, err := da.queryRelatedResources(ctx, subscriptionID, `
		resources
		| where type == "microsoft.compute/virtualmachines"
		| where subscriptionId == "`+subscriptionID+`"
		| where properties.diagnosticsProfile.bootDiagnostics.storageUri contains "`+resourceGroup+`"
		| project id, name, type
	`)
	if err == nil {
		for _, vm := range vms {
			graph.Dependents = append(graph.Dependents, ResourceDependency{
				ID:           vm["id"].(string),
				Name:         vm["name"].(string),
				Type:         vm["type"].(string),
				Relationship: DependencyStorage,
				Direction:    "inbound",
				Properties:   map[string]any{"role": "boot-diagnostics"},
			})
		}
	}

	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})
}

// analyzeGeneric performs generic dependency analysis for other resource types
func (da *DependencyAnalyzer) analyzeGeneric(ctx context.Context, resourceID, subscriptionID, resourceGroup string, graph *ResourceDependencyGraph) {
	// Add resource group as parent
	graph.Dependencies = append(graph.Dependencies, ResourceDependency{
		ID:           fmt.Sprintf("/subscriptions/%s/resourceGroups/%s", subscriptionID, resourceGroup),
		Name:         resourceGroup,
		Type:         "microsoft.resources/resourcegroups",
		Relationship: DependencyParent,
		Direction:    "outbound",
	})

	// Query resources in same resource group (siblings)
	siblings, err := da.queryRelatedResources(ctx, subscriptionID, fmt.Sprintf(`
		resources
		| where type != "microsoft.resources/resourcegroups"
		| where resourceGroup == "%s"
		| where subscriptionId == "%s"
		| where id != "%s"
		| take 10
		| project id, name, type
	`, resourceGroup, subscriptionID, resourceID))
	if err == nil {
		for _, sibling := range siblings {
			graph.Dependents = append(graph.Dependents, ResourceDependency{
				ID:           sibling["id"].(string),
				Name:         sibling["name"].(string),
				Type:         sibling["type"].(string),
				Relationship: DependencyReference,
				Direction:    "inbound",
				Properties:   map[string]any{"role": "sibling"},
			})
		}
	}
}

// queryRelatedResources executes a Resource Graph query
func (da *DependencyAnalyzer) queryRelatedResources(ctx context.Context, subscriptionID string, query string) ([]map[string]any, error) {
	if da.argClient == nil {
		return nil, fmt.Errorf("ARG client not available")
	}

	req := armresourcegraph.QueryRequest{
		Subscriptions: []*string{&subscriptionID},
		Query:         &query,
	}

	resp, err := da.argClient.Resources(ctx, req, nil)
	if err != nil {
		return nil, err
	}

	if resp.Data == nil {
		return nil, fmt.Errorf("no data returned")
	}

	results := make([]map[string]any, 0)
	for _, row := range resp.Data.([]any) {
		if m, ok := row.(map[string]any); ok {
			results = append(results, m)
		}
	}

	return results, nil
}

// RegisterDependencyRoutes registers the dependency API routes
func RegisterDependencyRoutes(r *gin.Engine, db *sql.DB, argClient *armresourcegraph.Client) {
	analyzer := NewDependencyAnalyzer(db, argClient)

	r.GET("/api/dependencies", func(c *gin.Context) {
		resourceID := c.Query("id")
		if resourceID == "" {
			c.JSON(400, gin.H{"error": "missing 'id' query parameter"})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()

		graph, err := analyzer.AnalyzeDependencies(ctx, resourceID)
		if err != nil {
			log.Printf("Error analyzing dependencies for %s: %v", resourceID, err)
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, graph)
	})

	// Get dependency graph for multiple resources (bulk)
	r.POST("/api/dependencies/bulk", func(c *gin.Context) {
		var req struct {
			ResourceIDs []string `json:"resourceIds"`
		}
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "invalid request"})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()

		graphs := make([]*ResourceDependencyGraph, 0, len(req.ResourceIDs))
		for _, id := range req.ResourceIDs {
			graph, err := analyzer.AnalyzeDependencies(ctx, id)
			if err != nil {
				log.Printf("Error analyzing dependencies for %s: %v", id, err)
				continue
			}
			graphs = append(graphs, graph)
		}

		c.JSON(200, gin.H{"graphs": graphs})
	})
}

// CreateDependenciesTable creates the table for caching dependency data
func CreateDependenciesTable(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS resource_dependencies (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			resource_id TEXT NOT NULL,
			dependency_id TEXT NOT NULL,
			dependency_name TEXT,
			dependency_type TEXT,
			relationship TEXT,
			direction TEXT,
			properties TEXT,
			fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(resource_id, dependency_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create resource_dependencies table: %w", err)
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_deps_resource ON resource_dependencies(resource_id)`)
	if err != nil {
		log.Printf("Warning: failed to create index: %v", err)
	}

	return nil
}
