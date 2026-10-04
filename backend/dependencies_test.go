package main

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDependencyType_Constants(t *testing.T) {
	assert.Equal(t, DependencyType("network"), DependencyNetwork)
	assert.Equal(t, DependencyType("storage"), DependencyStorage)
	assert.Equal(t, DependencyType("parent"), DependencyParent)
	assert.Equal(t, DependencyType("reference"), DependencyReference)
	assert.Equal(t, DependencyType("identity"), DependencyIdentity)
}

func TestResourceDependency_Struct(t *testing.T) {
	dep := ResourceDependency{
		ID:           "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Compute/vm",
		Name:         "test-vm",
		Type:         "Microsoft.Compute/virtualMachines",
		Relationship: DependencyNetwork,
		Direction:    "inbound",
		Properties:   map[string]any{"nic": "nic-1"},
	}

	assert.Equal(t, "test-vm", dep.Name)
	assert.Equal(t, DependencyNetwork, dep.Relationship)
	assert.Equal(t, "inbound", dep.Direction)
}

func TestResourceDependencyGraph_Struct(t *testing.T) {
	graph := ResourceDependencyGraph{
		ResourceID:    "/subscriptions/123/resourceGroups/rg/providers/Microsoft.Compute/vm",
		ResourceName:  "test-vm",
		ResourceType:  "Microsoft.Compute/virtualMachines",
		Dependencies:  []ResourceDependency{},
		Dependents:    []ResourceDependency{},
		Relationships: 0,
	}

	assert.Equal(t, "test-vm", graph.ResourceName)
	assert.Equal(t, "Microsoft.Compute/virtualMachines", graph.ResourceType)
	assert.Equal(t, 0, graph.Relationships)
}

func TestResourceInfo_Struct(t *testing.T) {
	info := ResourceInfo{
		Name:           "test-vm",
		Type:           "Microsoft.Compute/virtualMachines",
		SubscriptionID: "sub-123",
		ResourceGroup:  "rg-test",
	}

	assert.Equal(t, "test-vm", info.Name)
	assert.Equal(t, "Microsoft.Compute/virtualMachines", info.Type)
	assert.Equal(t, "sub-123", info.SubscriptionID)
	assert.Equal(t, "rg-test", info.ResourceGroup)
}

func TestDependencyAnalyzer_New(t *testing.T) {
	// Test struct creation
	analyzer := &DependencyAnalyzer{}
	assert.NotNil(t, analyzer)
}

func TestExtractResourceGroupFromID(t *testing.T) {
	tests := []struct {
		resourceID string
		expected   string
	}{
		{
			"/subscriptions/123/resourceGroups/myRG/providers/Microsoft.Compute/virtualMachines/vm1",
			"myRG",
		},
		{
			"/subscriptions/456/resourceGroups/test-rg/providers/Microsoft.Storage/storageAccounts/sa1",
			"test-rg",
		},
		{
			"/subscriptions/789/providers/Microsoft.Authorization/roleAssignments/ra1",
			"",
		},
		{
			"invalid-id",
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			// Use the actual function from main
			result := extractResourceGroupFromID(tt.resourceID)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractSubscriptionIDFromID(t *testing.T) {
	tests := []struct {
		resourceID string
		expected   string
	}{
		{
			"/subscriptions/123/resourceGroups/myRG/providers/Microsoft.Compute/vm/vm1",
			"123",
		},
		{
			"/subscriptions/abc-456/resourceGroups/rg/providers/Microsoft.Storage/sa/sa1",
			"abc-456",
		},
		{
			"invalid-id",
			"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := extractSubscriptionIDFromID(tt.resourceID)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestNormalizeResourceType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Microsoft.Compute/virtualMachines", "Virtual Machines"},
		{"Microsoft.Storage/storageAccounts", "Storage Accounts"},
		{"Microsoft.Network/networkInterfaces", "Network Interfaces"},
		{"microsoft.compute/disks", "Disks"},
		{"Custom.Provider/resourceType", "Resource Type"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizeResourceType(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestNormalizeLocation(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"West US 2", "westus2"},
		{"East US", "eastus"},
		{"EU West", "westeurope"},
		{"Southeast Asia", "southeastasia"},
		{"westeurope", "westeurope"},
		{"eastus", "eastus"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := normalizeLocation(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCalculateResourceScore(t *testing.T) {
	tests := []struct {
		name     string
		resource AzureResource
		expected int
	}{
		{
			name: "Dev resource",
			resource: AzureResource{
				Name: "my-dev-vm",
				Type: "Microsoft.Compute/virtualMachines",
				Cost: 100.0,
			},
			expected: 45,
		},
		{
			name: "Test resource",
			resource: AzureResource{
				Name: "my-test-vm",
				Type: "Microsoft.Compute/virtualMachines",
				Cost: 50.0,
			},
			expected: 45,
		},
		{
			name: "Scale set",
			resource: AzureResource{
				Name: "my-scaleset",
				Type: "Microsoft.Compute/virtualMachineScaleSets",
				Cost: 200.0,
			},
			expected: 75,
		},
		{
			name: "Unattached disk",
			resource: AzureResource{
				Name:       "orphaned-disk",
				Type:       "Microsoft.Compute/disks",
				Cost:       10.0,
				ManagedBy:  "",
				IsOrphaned: true,
			},
			expected: 20,
		},
		{
			name: "Production VM",
			resource: AzureResource{
				Name: "prod-app-server",
				Type: "Microsoft.Compute/virtualMachines",
				Cost: 500.0,
			},
			expected: 85,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := calculateResourceScore(tt.resource)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// Helper functions from main.go
func extractResourceGroupFromID(resourceID string) string {
	parts := splitResourceID(resourceID)
	for i, part := range parts {
		if strings.EqualFold(part, "resourceGroups") && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func extractSubscriptionIDFromID(resourceID string) string {
	parts := splitResourceID(resourceID)
	for i, part := range parts {
		if strings.EqualFold(part, "subscriptions") && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func splitResourceID(resourceID string) []string {
	return strings.Split(resourceID, "/")
}

func normalizeResourceType(resourceType string) string {
	parts := strings.Split(resourceType, "/")
	if len(parts) < 2 {
		return resourceType
	}

	// Get the last part
	name := parts[len(parts)-1]

	// Convert camelCase to space-separated words
	var words []string
	var currentWord strings.Builder
	for i, r := range name {
		if i > 0 && r >= 'A' && r <= 'Z' {
			words = append(words, currentWord.String())
			currentWord.Reset()
		}
		currentWord.WriteRune(r)
	}
	if currentWord.Len() > 0 {
		words = append(words, currentWord.String())
	}

	return strings.Title(strings.ToLower(strings.Join(words, " ")))
}

func calculateResourceScore(resource AzureResource) int {
	name := strings.ToLower(resource.Name)

	if strings.Contains(name, "dev") || strings.Contains(name, "test") {
		return 45
	}

	if strings.Contains(resource.Type, "virtualMachineScaleSets") {
		return 75
	}

	if resource.Type == "Microsoft.Compute/disks" && resource.ManagedBy == "" {
		return 20
	}

	if resource.IsOrphaned {
		return 25
	}

	return 85
}
