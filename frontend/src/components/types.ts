// ─── Azure Resource Types ─────────────────────────────────────────────────────

export interface AzureResource {
  id: string;
  name: string;
  type: string;
  location: string;
  subscriptionId: string;
  subscriptionName?: string;
  resourceGroup: string;
  cost?: number;
  tags?: Record<string, string>;
  optimization?: string;
  status?: string;
  score?: number;
  isOrphaned?: boolean;
  createdBy?: string;
  createdByType?: string;
  createdAt?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
}

export interface CostPrediction {
  cost: number;
  previousCost?: number;
  trend?: number;
  resourceId?: string;
  resourceGroup?: string;
  resourceType?: string;
  resourceLocation?: string;
  subscriptionId: string;
}

export interface CostItem {
  resourceGroup: string;
  resourceType: string;
  resourceLocation: string;
  cost: number;
}

export interface AggregatedCost {
  cost: number;
  previousCost: number;
  trend: number;
  resourceId: string;
  resourceGroup: string;
  resourceType: string;
  resourceLocation: string;
  subscriptionId: string;
}

export interface ResourceChange {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  changeType: string;
  field: string;
  oldValue: string;
  newValue: string;
  timestamp: string;
  cost: number;
  changedBy: string;
}

export interface DayImpact {
  date: string;
  totalDailyCost: number;
  addedCost: number;
  removedCost: number;
  createdCount: number;
  deletedCount: number;
}

export interface ResourceDependency {
  id: string;
  name: string;
  type: string;
  subscriptionId?: string;
  resourceGroup?: string;
  location?: string;
  relationship?: string;
  direction?: 'inbound' | 'outbound';
  properties?: Record<string, any>;
}

export interface DependencyGraph {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  dependencies: ResourceDependency[];
  dependents: ResourceDependency[];
  relationships: number;
  generatedAt: string;
}

// ─── Sort Configuration ───────────────────────────────────────────────────────

export type SortConfig = { key: string | null; direction: 'asc' | 'desc' };

// ─── Metric Series ──────────────────────────────────────────────────────────────

export type MetricSeries = Record<string, number[]>;

// ─── Waste Category ─────────────────────────────────────────────────────────────

export interface WasteItem {
  resourceId: string;
  name: string;
  category: string;
  categoryLabel: string;
  severity: 'high' | 'medium' | 'low';
  suggestion: string;
  monthlyCost: number;
  potentialSavings: number;
  resourceGroup?: string;
  location?: string;
  type?: string;
}

export interface WasteData {
  items: WasteItem[];
  byCategory: Record<string, { count: number; savings: number }>;
  totalSavings: number;
  totalCount: number;
}

// ─── Cost Forecast ──────────────────────────────────────────────────────────────

export interface ForecastData {
  currentMonth: number;
  predictedMonth: number;
  trend: number;
  daily: Array<{ date: string; actual?: number; predicted?: number }>;
}

// ─── Filter Types ───────────────────────────────────────────────────────────────

export interface FilterPreset {
  name: string;
  regionFilter: string[];
  subFilter: string[];
  rgFilter: string[];
  typeFilter: string;
  showOrphanedOnly: boolean;
  showUnattachedDiskOnly: boolean;
  showUnassignedPIPOnly: boolean;
  showUnattachedNICOnly: boolean;
}

// ─── Toast Types ────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

// ─── Alert Modal ────────────────────────────────────────────────────────────────

export interface AlertModalState {
  open: boolean;
  title: string;
  message: string;
  icon: 'warning' | 'danger' | 'info';
}
