// Storage keys
export const STORAGE_KEYS = {
  SEARCH: 'cloudviz-search',
  REGION_FILTER: 'cloudviz-regionFilter',
  SUB_FILTER: 'cloudviz-subFilter',
  RG_FILTER: 'cloudviz-rgFilter',
  TYPE_FILTER: 'cloudviz-typeFilter',
  CREATOR_FILTER: 'cloudviz-creatorFilter',
  ORPHANED: 'cloudviz-orphaned',
  UNATTACHED_DISK: 'cloudviz-unattachedDisk',
  UNASSIGNED_PIP: 'cloudviz-unassignedPIP',
  UNATTACHED_NIC: 'cloudviz-unattachedNIC',
  SIDEBAR_COLLAPSED: 'cloudviz-sidebar-collapsed',
  COST_PER_DAY: 'cloudviz-costPerDay',
  BUDGET_LIMIT: 'cloudviz-budgetLimit',
  SHOW_ANOMALIES: 'cloudviz-showAnomalies',
  ACTIVE_TAB: 'cloudviz-activeTab',
  FAVORITES: 'cloudviz:favorites',
} as const;

// API endpoints
export const API_ENDPOINTS = {
  RESOURCES: '/api/resources',
  FILTERS: '/api/filters',
  COSTS: '/api/costs',
  COSTS_STREAM: '/api/costs/stream',
  EXPORT: '/api/export',
  AI_INSIGHTS: '/api/ai-insights',
  DEPENDENCIES: '/api/resources',
  WASTE: '/api/waste',
  HISTORY: '/api/history',
  RG_TRENDS: '/api/rg-trends',
} as const;

// Default values
export const DEFAULTS = {
  PAGE_SIZE: 50,
  DEBOUNCE_DELAY: 300,
  REFRESH_INTERVAL: 300000, // 5 minutes
  COST_CACHE_TTL: 21600000, // 6 hours
  MAX_EXPORT_ITEMS: 10000,
} as const;

// Chart colors
export const CHART_COLORS = {
  PRIMARY: '#0ea5e9',
  SECONDARY: '#8b5cf6',
  SUCCESS: '#10b981',
  WARNING: '#f59e0b',
  DANGER: '#ef4444',
  INFO: '#06b6d4',
  GRAY: '#6b7280',
} as const;

// Resource type colors
export const RESOURCE_TYPE_COLORS: Record<string, string> = {
  'Microsoft.Compute/virtualMachines': '#0ea5e9',
  'Microsoft.Storage/storageAccounts': '#8b5cf6',
  'Microsoft.Network/networkInterfaces': '#10b981',
  'Microsoft.Network/publicIPAddresses': '#f59e0b',
  'Microsoft.Compute/disks': '#ef4444',
  'Microsoft.Sql/servers/databases': '#06b6d4',
  'Microsoft.Web/sites': '#ec4899',
  'Microsoft.ContainerInstance/containerGroups': '#84cc16',
};

// Efficiency score thresholds
export const EFFICIENCY_THRESHOLDS = {
  EXCELLENT: 85,
  GOOD: 70,
  FAIR: 50,
  POOR: 30,
} as const;
