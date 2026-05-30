import { useState, useMemo } from 'react';
import type { ResourceChange, AzureResource } from './types';
import { getTimeAgo, friendlyType } from './utils';

// ─── HistoryView Component ──────────────────────────────────────────────────────

interface HistoryViewProps {
  history: ResourceChange[];
  historyLoading: boolean;
  fetchHistory: () => void;
  resources: AzureResource[];
  setSelectedResource: (r: AzureResource | null) => void;
  setCurrentPage: (p: number) => void;
  setAlertModal: (modal: { open: boolean; title: string; message: string; icon: 'warning' | 'danger' | 'info' }) => void;
}

export function HistoryView({ history, historyLoading, fetchHistory, resources, setSelectedResource, setCurrentPage, setAlertModal }: HistoryViewProps) {
  const [filterType, setFilterType] = useState<'all' | 'created' | 'deleted' | 'modified'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByDate, setGroupByDate] = useState(true);
  const [costImpactOnly] = useState(false);

  const filteredHistory = useMemo(() => {
    let result = history;
    if (filterType !== 'all') {
      result = result.filter(h => (h.changeType || '').toLowerCase() === filterType);
    }
    if (costImpactOnly) {
      result = result.filter(h => (h.cost || 0) > 0 && (h.changeType === 'created' || h.changeType === 'deleted'));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(h =>
        h.resourceName.toLowerCase().includes(q) ||
        h.resourceType.toLowerCase().includes(q)
      );
    }
    return result;
  }, [history, filterType, searchQuery]);

  const groupedHistory = useMemo(() => {
    if (!groupByDate) return { 'All Changes': filteredHistory };
    const groups: Record<string, ResourceChange[]> = {};
    const today = new Date().toDateString();
    // eslint-disable-next-line react-hooks/purity
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    filteredHistory.forEach(h => {
      const date = new Date(h.timestamp);
      const dateStr = date.toDateString();
      let groupKey: string;
      if (dateStr === today) groupKey = 'Today';
      else if (dateStr === yesterday) groupKey = 'Yesterday';
      // eslint-disable-next-line react-hooks/purity
      else if (Date.now() - date.getTime() < 7 * 86400000) groupKey = 'This Week';
      else groupKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(h);
    });
    return groups;
  }, [filteredHistory, groupByDate]);

  const stats = useMemo(() => {
    const created = history.filter(h => h.changeType === 'created').length;
    const deleted = history.filter(h => h.changeType === 'deleted').length;
    const modified = history.filter(h => h.changeType === 'modified').length;
    const totalCost = history.reduce((sum, h) => sum + (h.cost || 0), 0);
    return { created, deleted, modified, totalCost };
  }, [history]);

  const topUsers = useMemo(() => {
    const counts: Record<string, { total: number; created: number; deleted: number; modified: number }> = {};
    history.forEach(h => {
      const user = h.changedBy || 'Unknown';
      if (!counts[user]) counts[user] = { total: 0, created: 0, deleted: 0, modified: 0 };
      counts[user].total++;
      const ct = (h.changeType || '').toLowerCase() as 'created' | 'deleted' | 'modified';
      if (ct === 'created' || ct === 'deleted' || ct === 'modified') counts[user][ct]++;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([user, c]) => ({ user, ...c }));
  }, [history]);

  const handleResourceClick = (h: ResourceChange) => {
    if (h.changeType === 'deleted') {
      setAlertModal({
        open: true,
        title: 'Resource Deleted',
        message: `This resource was deleted and is no longer available.\n\nName: ${h.resourceName}\nDeleted: ${new Date(h.timestamp).toLocaleString()}`,
        icon: 'danger',
      });
      return;
    }
    const resource = resources.find(r => r.id === h.resourceId);
    if (resource) {
      setSelectedResource(resource);
      setCurrentPage(1);
    } else {
      setAlertModal({
        open: true,
        title: 'Resource Not Found',
        message: `Could not find current details for this resource.\n\nName: ${h.resourceName}\nID: ${h.resourceId}`,
        icon: 'warning',
      });
    }
  };

  if (historyLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16, color: 'var(--text-2)' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
        <span style={{ fontSize: 15, fontWeight: 500 }}>Loading history...</span>
      </div>
    );
  }

  if (!history.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16, color: 'var(--text-2)' }}>
        <button className="btn btn-primary" onClick={fetchHistory} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.36" /></svg>
          Load History
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>Created</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--accent)' }}>{stats.created}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--danger-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>Deleted</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--danger)' }}>{stats.deleted}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 4"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>Modified</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--blue)' }}>{stats.modified}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase' }}>Total Cost Impact</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--accent)' }}>${stats.totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          </div>
        </div>
      </div>

      {/* Top Users Leaderboard */}
      {topUsers.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Top Users by Activity</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Ranked by total resource changes in this period</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topUsers.map((u, idx) => {
              const maxCount = topUsers[0].total;
              const barPct = maxCount > 0 ? Math.round((u.total / maxCount) * 100) : 0;
              const isUnknown = u.user === 'Unknown';
              const avatarColors = ['var(--accent)', 'var(--blue)', '#a855f7', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16', '#f97316'];
              const color = isUnknown ? 'var(--text-3)' : avatarColors[idx % avatarColors.length];
              const initials = isUnknown ? '?' : u.user.split('@')[0].slice(0, 2).toUpperCase();
              return (
                <div key={u.user} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 22, textAlign: 'right', fontSize: 11, fontWeight: 700, color: idx < 3 ? 'var(--accent)' : 'var(--text-3)', flexShrink: 0 }}>
                    #{idx + 1}
                  </div>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: isUnknown ? 'var(--bg-surface)' : `${color}22`, border: `1.5px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color }}>{initials}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: isUnknown ? 'var(--text-3)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={u.user}>
                        {u.user}
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                        {u.created > 0 && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>{u.created}↑</span>}
                        {u.deleted > 0 && <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 700 }}>{u.deleted}↓</span>}
                        {u.modified > 0 && <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700 }}>{u.modified}✎</span>}
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-2)' }}>{u.total}</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barPct}%`, background: isUnknown ? 'var(--border)' : color, borderRadius: 2, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'created', 'deleted', 'modified'] as const).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={filterType === type ? 'btn btn-primary' : 'btn'}
                style={{ fontSize: 12, padding: '5px 14px', textTransform: 'capitalize' }}
              >
                {type}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search history..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-1)', fontSize: 13, flex: 1, minWidth: 200 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={groupByDate} onChange={e => setGroupByDate(e.target.checked)} />
            Group by date
          </label>
        </div>

        {Object.entries(groupedHistory).map(([group, items]) => (
          <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groupByDate && (
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 0' }}>
                {group} ({items.length})
              </div>
            )}
            {items.map((h, i) => (
              <div
                key={i}
                className="card"
                style={{ padding: '12px 16px', cursor: 'pointer', transition: 'all 0.15s' }}
                onClick={() => handleResourceClick(h)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: h.changeType === 'created' ? 'var(--accent-dim)' : h.changeType === 'deleted' ? 'var(--danger-dim)' : 'var(--blue-dim)',
                    border: `1px solid ${h.changeType === 'created' ? 'var(--accent)' : h.changeType === 'deleted' ? 'var(--danger)' : 'var(--blue)'}30`
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={h.changeType === 'created' ? 'var(--accent)' : h.changeType === 'deleted' ? 'var(--danger)' : 'var(--blue)'} strokeWidth="2.5">
                      {h.changeType === 'created' && <path d="M12 5v14M5 12h14"/>}
                      {h.changeType === 'deleted' && <path d="M5 12h14"/>}
                      {h.changeType === 'modified' && <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>}
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{h.resourceName}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                        background: h.changeType === 'created' ? 'var(--accent-dim)' : h.changeType === 'deleted' ? 'var(--danger-dim)' : 'var(--blue-dim)',
                        color: h.changeType === 'created' ? 'var(--accent)' : h.changeType === 'deleted' ? 'var(--danger)' : 'var(--blue)'
                      }}>
                        {h.changeType}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>
                      {friendlyType(h.resourceType)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      {h.changedBy || 'Unknown'} · {getTimeAgo(h.timestamp)}
                    </div>
                  </div>
                  {h.cost > 0 && (
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: h.changeType === 'deleted' ? 'var(--accent)' : 'var(--danger)' }}>
                        {h.changeType === 'deleted' ? '-' : '+'}${h.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>/mo</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        {filteredHistory.length === 0 && (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.5 }}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <div style={{ fontSize: 14, fontWeight: 600 }}>No history found</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Try adjusting your filters</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryView;
