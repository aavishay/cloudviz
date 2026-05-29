import { useState, useMemo } from 'react';
import { ScoreRing } from './ScoreRing';
import { Sparkline } from './Sparkline';

interface Resource {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  subscriptionName?: string;
  cost?: number;
  score?: number;
  isOrphaned?: boolean;
  status?: string;
  trend?: number[];
}

interface ResourceTableProps {
  resources: Resource[];
  loading?: boolean;
  onRowClick?: (resource: Resource) => void;
  onFilterByType?: (type: string) => void;
  onFilterByLocation?: (location: string) => void;
  onFilterByRG?: (rg: string) => void;
}

export function ResourceTable({
  resources,
  loading = false,
  onRowClick,
  onFilterByType,
  onFilterByLocation,
  onFilterByRG
}: ResourceTableProps) {
  const [sortKey, setSortKey] = useState<keyof Resource>('cost');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const sortedResources = useMemo(() => {
    return [...resources].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [resources, sortKey, sortDirection]);

  const handleSort = (key: keyof Resource) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const friendlyType = (type: string) => {
    const parts = type.split('/');
    return parts[parts.length - 1]?.replace(/_/g, ' ') || type;
  };

  if (loading) {
    return (
      <div className="resource-table-skeleton" style={{ padding: 16 }}>
        {Array(5).fill(null).map((_, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 16,
            padding: '16px',
            borderBottom: '1px solid var(--border)',
            animation: `fadeSlideUp 0.3s ease ${i * 0.1}s backwards`
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-hover)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 8 }} />
              <div style={{ height: 12, width: '40%', borderRadius: 4, background: 'var(--bg-hover)' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="resource-table-container" style={{ width: '100%' }}>
      {/* Desktop Table */}
      <div className="desktop-table" style={{ display: 'block' }}>
        <div style={{
          overflowX: 'auto',
          borderRadius: 14,
          border: '1px solid var(--border)',
          background: 'var(--bg-card)'
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            minWidth: 800
          }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)' }}>
                {[
                  { key: 'name', label: 'Resource' },
                  { key: 'type', label: 'Type' },
                  { key: 'location', label: 'Location' },
                  { key: 'resourceGroup', label: 'Resource Group' },
                  { key: 'cost', label: 'Cost' },
                  { key: 'score', label: 'Score' }
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key as keyof Resource)}
                    style={{
                      padding: '12px 16px',
                      textAlign: 'left',
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-2)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      borderBottom: '1px solid var(--border)'
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {label}
                      {sortKey === key && (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          {sortDirection === 'asc' ? (
                            <path d="M12 19V5M5 12l7-7 7 7" />
                          ) : (
                            <path d="M12 5v14M19 12l-7 7-7-7" />
                          )}
                        </svg>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedResources.map((resource, index) => (
                <tr
                  key={resource.id}
                  onClick={() => onRowClick?.(resource)}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    cursor: onRowClick ? 'pointer' : 'default',
                    background: resource.isOrphaned ? 'rgba(244, 63, 94, 0.05)' : undefined,
                    animation: `fadeSlideUp 0.3s ease ${index * 0.02}s backwards`,
                    transition: 'background 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = resource.isOrphaned ? 'rgba(244, 63, 94, 0.05)' : '';
                  }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: resource.isOrphaned ? 'var(--danger-dim)' : 'var(--accent-dim)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={resource.isOrphaned ? 'var(--danger)' : 'var(--accent)'} strokeWidth={2}>
                          <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                          {resource.name}
                        </div>
                        {resource.subscriptionName && (
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {resource.subscriptionName}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      onClick={(e) => { e.stopPropagation(); onFilterByType?.(resource.type); }}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'var(--bg-surface)',
                        fontSize: 11,
                        cursor: onFilterByType ? 'pointer' : 'default',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {friendlyType(resource.type)}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      onClick={(e) => { e.stopPropagation(); onFilterByLocation?.(resource.location); }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'rgba(6, 182, 212, 0.1)',
                        color: 'var(--cyan)',
                        fontSize: 11,
                        cursor: onFilterByLocation ? 'pointer' : 'default',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {resource.location}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      onClick={(e) => { e.stopPropagation(); onFilterByRG?.(resource.resourceGroup); }}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'var(--bg-surface)',
                        fontSize: 11,
                        cursor: onFilterByRG ? 'pointer' : 'default',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {resource.resourceGroup}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap'
                      }}>
                        ${resource.cost?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                      </span>
                      {resource.trend && resource.trend.length > 1 && (
                        <Sparkline data={resource.trend} width={60} height={20} showArea={false} />
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <ScoreRing score={resource.score || 0} size={28} showTooltip={true} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="mobile-cards" style={{ display: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sortedResources.map((resource, index) => (
            <div
              key={resource.id}
              onClick={() => toggleRow(resource.id)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: 16,
                cursor: 'pointer',
                animation: `fadeSlideUp 0.3s ease ${index * 0.02}s backwards`
              }}
            >
              {/* Card Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 12
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: resource.isOrphaned ? 'var(--danger-dim)' : 'var(--accent-dim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={resource.isOrphaned ? 'var(--danger)' : 'var(--accent)'} strokeWidth={2}>
                      <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: 'var(--text-1)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {resource.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                      {friendlyType(resource.type)}
                    </div>
                  </div>
                </div>
                <ScoreRing score={resource.score || 0} size={32} />
              </div>

              {/* Quick Stats */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginBottom: 12
              }}>
                <div style={{
                  background: 'var(--bg-surface)',
                  borderRadius: 10,
                  padding: 12
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Cost
                  </div>
                  <div style={{
                    fontSize: 18,
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-1)',
                    marginTop: 4
                  }}>
                    ${resource.cost?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg-surface)',
                  borderRadius: 10,
                  padding: 12
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Location
                  </div>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--cyan)',
                    marginTop: 6
                  }}>
                    {resource.location}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedRows.has(resource.id) && (
                <div style={{
                  borderTop: '1px solid var(--border)',
                  paddingTop: 12,
                  marginTop: 12,
                  animation: 'fadeSlideUp 0.2s ease'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Resource Group:</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{resource.resourceGroup}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Subscription:</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{resource.subscriptionName}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Type:</span>
                      <span style={{ fontSize: 12 }}>{resource.type}</span>
                    </div>
                    {resource.trend && resource.trend.length > 1 && (
                      <div style={{ marginTop: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Trend:</span>
                        <Sparkline data={resource.trend} width={200} height={30} />
                      </div>
                    )}
                  </div>

                  {onRowClick && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRowClick(resource); }}
                      style={{
                        width: '100%',
                        marginTop: 12,
                        padding: '10px',
                        borderRadius: 8,
                        background: 'var(--accent)',
                        color: '#fff',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      View Details
                    </button>
                  )}
                </div>
              )}

              {/* Expand Indicator */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                marginTop: 8,
                color: 'var(--text-3)'
              }}>
                <svg
                  width={20}
                  height={20}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  style={{
                    transform: expandedRows.has(resource.id) ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease'
                  }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .desktop-table {
            display: none !important;
          }
          .mobile-cards {
            display: block !important;
          }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default ResourceTable;
