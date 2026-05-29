import { Card, StatCard, ProgressBar, MiniChart } from './DashboardPrimitives';

interface InsightsPanelProps {
  totalResources: number;
  orphanedCount: number;
  unattachedDiskCount: number;
  unassignedPIPCount: number;
  unattachedNICCount: number;
  avgEfficiency: number;
  efficiencyTrend: number[];
  onViewOrphaned: () => void;
  onViewUnattachedDisks: () => void;
  onViewUnassignedPIPs: () => void;
  onViewUnattachedNICs: () => void;
}

export function InsightsPanel(props: InsightsPanelProps) {
  const {
    totalResources,
    orphanedCount,
    unattachedDiskCount,
    unassignedPIPCount,
    avgEfficiency,
    efficiencyTrend,
    onViewOrphaned,
    onViewUnattachedDisks,
    onViewUnassignedPIPs,
    // onViewUnattachedNICs - unused currently
  } = props;
  return (
    <Card title="Insights" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <StatCard
          label="Total Resources"
          value={totalResources.toLocaleString()}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>}
        />
        <StatCard
          label="Orphaned"
          value={orphanedCount.toString()}
          alert={orphanedCount > 0}
          onClick={onViewOrphaned}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>}
        />
        <StatCard
          label="Unattached Disks"
          value={unattachedDiskCount.toString()}
          alert={unattachedDiskCount > 0}
          onClick={onViewUnattachedDisks}
        />
        <StatCard
          label="Unassigned PIPs"
          value={unassignedPIPCount.toString()}
          alert={unassignedPIPCount > 0}
          onClick={onViewUnassignedPIPs}
        />
      </div>
      {efficiencyTrend.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Efficiency Trend</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: avgEfficiency > 70 ? 'var(--success)' : avgEfficiency > 40 ? 'var(--warning)' : 'var(--danger)' }}>
              {avgEfficiency.toFixed(0)}%
            </span>
          </div>
          <MiniChart data={efficiencyTrend} color={avgEfficiency > 70 ? '#10b981' : avgEfficiency > 40 ? '#f59e0b' : '#ef4444'} />
        </div>
      )}
    </Card>
  );
}

interface SummaryPanelProps {
  totalResources: number;
  totalCost: number;
  costPerDay: boolean;
  budgetLimit: number;
  projectedMonthly: number;
  costTrend: number[];
  efficiencyScore: number;
  onViewResources: () => void;
  onViewCosts: () => void;
}

export function SummaryPanel(props: SummaryPanelProps) {
  const {
    totalResources,
    totalCost,
    costPerDay,
    budgetLimit,
    projectedMonthly,
    costTrend,
    // efficiencyScore - unused currently
    onViewResources,
    onViewCosts,
  } = props;
  const formatCost = (cost: number) => {
    if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
    if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
    return `$${cost.toFixed(0)}`;
  };

  const budgetPct = budgetLimit > 0 ? (projectedMonthly / budgetLimit) * 100 : 0;

  return (
    <Card title="Summary" icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div onClick={onViewResources} style={{ cursor: 'pointer' }}>
          <StatCard
            label="Resources"
            value={totalResources.toLocaleString()}
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>}
          />
        </div>
        <div onClick={onViewCosts} style={{ cursor: 'pointer' }}>
          <StatCard
            label={costPerDay ? "Cost/Day" : "Cost/Month"}
            value={formatCost(totalCost)}
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
          />
        </div>
      </div>

      {budgetLimit > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Budget Utilization</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: budgetPct > 90 ? 'var(--danger)' : budgetPct > 70 ? 'var(--warning)' : 'var(--success)' }}>
              {budgetPct.toFixed(1)}%
            </span>
          </div>
          <ProgressBar value={budgetPct} color={budgetPct > 90 ? '#ef4444' : budgetPct > 70 ? '#f59e0b' : '#10b981'} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
            <span>${projectedMonthly.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${budgetLimit.toLocaleString()}</span>
            <span>Projected</span>
          </div>
        </div>
      )}

      {costTrend.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Cost Trend</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: costTrend[costTrend.length - 1] > costTrend[0] ? 'var(--danger)' : 'var(--success)' }}>
              {((costTrend[costTrend.length - 1] - costTrend[0]) / costTrend[0] * 100).toFixed(1)}%
            </span>
          </div>
          <MiniChart data={costTrend} color={costTrend[costTrend.length - 1] > costTrend[0] ? '#ef4444' : '#10b981'} />
        </div>
      )}
    </Card>
  );
}

// Re-export primitive components for dashboard use
export { Card, StatCard, ProgressBar, MiniChart } from './DashboardPrimitives';
