import { useState } from 'react';
import type { WasteData } from './types';

// ─── WasteView Component ────────────────────────────────────────────────────────

interface WasteViewProps {
  wasteData: WasteData | null;
  wasteLoading: boolean;
  fetchWaste: () => void;
  setSearchQuery: (q: string) => void;
  setActiveTab: (tab: any) => void;
  setCurrentPage: (p: number) => void;
}

const WASTE_CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  orphaned_disk: { label: 'Orphaned Disks', color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
  orphaned_nic:  { label: 'Unattached NICs', color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
  orphaned_pip:  { label: 'Unassigned PIPs', color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
  dev_vm_247:    { label: 'Dev VMs 24/7', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
  low_score:     { label: 'Low Utilization', color: 'var(--text-2)', bg: 'var(--bg-surface)' },
};

export function WasteView({ wasteData, wasteLoading, fetchWaste, setSearchQuery, setActiveTab, setCurrentPage }: WasteViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const items = wasteData?.items || [];
  const byCategory: Record<string, { count: number; savings: number }> = wasteData?.byCategory || {};
  const totalSavings: number = wasteData?.totalSavings || 0;
  const totalCount: number = wasteData?.totalCount || 0;

  const orphanedCount = (byCategory.orphaned_disk?.count || 0) + (byCategory.orphaned_nic?.count || 0) + (byCategory.orphaned_pip?.count || 0);
  const devVmCount = byCategory.dev_vm_247?.count || 0;
  const lowScoreCount = byCategory.low_score?.count || 0;

  const filteredItems = categoryFilter === 'all' ? items : items.filter((it: any) => it.category === categoryFilter);

  const severityColor = (sev: string) => {
    if (sev === 'high') return 'var(--danger)';
    if (sev === 'medium') return 'var(--warning)';
    return 'var(--text-3)';
  };

  const severityBg = (sev: string) => {
    if (sev === 'high') return 'rgba(239,68,68,0.1)';
    if (sev === 'medium') return 'rgba(245,158,11,0.1)';
    return 'var(--bg-surface)';
  };

  if (wasteLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16, color: 'var(--text-2)' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
        <span style={{ fontSize: 15, fontWeight: 500 }}>Analyzing resources...</span>
      </div>
    );
  }

  if (!wasteData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16, color: 'var(--text-2)' }}>
        <button className="btn btn-primary" onClick={fetchWaste} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" /></svg>
          Run Waste Analysis
        </button>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 12, color: 'var(--text-2)' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#22c55e' }}>No waste detected</span>
        <span style={{ fontSize: 13 }}>All resources appear to be appropriately utilized.</span>
        <button className="btn" onClick={fetchWaste} style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" /></svg>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>Waste Detection</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-3)' }}>Identifies idle, orphaned, and over-provisioned resources</p>
        </div>
        <button className="btn" onClick={fetchWaste} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" /></svg>
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Potential Savings</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--danger)' }}>${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-3)' }}>/mo</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{totalCount} waste items found</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Orphaned Resources</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--warning)' }}>{orphanedCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Disks, NICs & Public IPs</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Dev VMs Running 24/7</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#8b5cf6' }}>{devVmCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Could be scheduled off-hours</div>
        </div>
        <div className="card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Low Score Resources</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-2)' }}>{lowScoreCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Cost &gt;$50/mo, low efficiency</div>
        </div>
      </div>

      {/* Category filter tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: `All (${totalCount})` },
          { id: 'orphaned_disk', label: `Orphaned Disks (${byCategory.orphaned_disk?.count || 0})` },
          { id: 'orphaned_nic', label: `Unattached NICs (${byCategory.orphaned_nic?.count || 0})` },
          { id: 'orphaned_pip', label: `Unassigned PIPs (${byCategory.orphaned_pip?.count || 0})` },
          { id: 'dev_vm_247', label: `Dev VMs (${byCategory.dev_vm_247?.count || 0})` },
          { id: 'low_score', label: `Low Score (${byCategory.low_score?.count || 0})` },
        ].map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategoryFilter(cat.id)}
            className={categoryFilter === cat.id ? 'btn btn-primary' : 'btn'}
            style={{ fontSize: 12, padding: '5px 14px' }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Items list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredItems.length === 0 ? (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No items in this category
          </div>
        ) : filteredItems.map((item: any, idx: number) => {
          const meta = WASTE_CATEGORY_META[item.category] || { label: item.categoryLabel, color: 'var(--text-2)', bg: 'var(--bg-surface)' };
          return (
            <div
              key={item.resourceId || idx}
              className="card"
              style={{ padding: '14px 18px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onClick={() => {
                setSearchQuery(item.name || '');
                setActiveTab('resources');
                setCurrentPage(1);
              }}
              title="Click to view in Resources tab"
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{item.name}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: meta.bg, color: meta.color, border: `1px solid ${meta.color}`,
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>
                      {item.categoryLabel || meta.label}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: severityBg(item.severity), color: severityColor(item.severity),
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>
                      {item.severity}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                    <span>{item.resourceGroup}</span>
                    {item.location && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {item.location}</span>}
                    <span style={{ marginLeft: 8, opacity: 0.6, fontFamily: 'monospace', fontSize: 11 }}>{item.type?.split('/').slice(-1)[0]}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic' }}>{item.suggestion}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {item.monthlyCost > 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 2 }}>
                      Cost: <strong>${item.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>/mo
                    </div>
                  )}
                  {item.potentialSavings > 0 && (
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e' }}>
                      Save ${item.potentialSavings.toLocaleString(undefined, { maximumFractionDigits: 2 })}/mo
                    </div>
                  )}
                  {item.potentialSavings === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No direct cost</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default WasteView;
