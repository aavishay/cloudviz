import type { AzureResource, MetricSeries } from './types';
import { friendlyType, StatusDot } from './utils';

// ─── AIInsightsModal Component ──────────────────────────────────────────────────────────

interface AIInsightsModalProps {
  resource: AzureResource;
  onClose: () => void;
  insight: {
    metrics: MetricSeries;
    recommendations: Array<{
      category: string;
      action: string;
      estimatedSavings: number;
      savingsPercent: number;
      rationale: string;
      priority: number;
    }>;
  } | null;
  loading: boolean;
  onViewDependencies?: () => void;
}

export function AIInsightsModal({ resource, onClose, insight, loading, onViewDependencies }: AIInsightsModalProps) {
  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent) 0%, #34d399 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              </div>
              <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resource.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 42 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500, padding: '3px 8px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)' }}>{friendlyType(resource.type)}</span>
              {resource.status && <StatusDot status={resource.status} />}
              <button
                onClick={() => navigator.clipboard.writeText(resource.id)}
                title={`Copy Resource ID: ${resource.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'monospace'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy ID
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {onViewDependencies && (
              <button
                onClick={onViewDependencies}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="3" />
                  <circle cx="5" cy="19" r="3" />
                  <circle cx="19" cy="19" r="3" />
                  <path d="M12 8v3M7 16h6m4 0h-6" />
                </svg>
                View Dependencies
              </button>
            )}
            <button className="modal-close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="info-grid">
            <div className="info-cell">
              <div className="info-cell-label">Resource Group</div>
              <div className="info-cell-value" style={{ fontSize: 12, wordBreak: 'break-all' }}>{resource.resourceGroup}</div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">Resource ID</div>
              <div className="info-cell-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{resource.id}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(resource.id)}
                  title="Copy Resource ID"
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    fontSize: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy
                </button>
              </div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">Location</div>
              <div className="info-cell-value">{resource.location}</div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">Monthly Cost</div>
              <div className="info-cell-value" style={{ color: resource.cost && resource.cost > 0 ? 'var(--danger)' : 'var(--text-2)' }}>
                {resource.cost ? `$${resource.cost.toLocaleString()}/mo` : 'N/A'}
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ position: 'relative', width: 48, height: 48 }}>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    border: '3px solid var(--bg-surface)',
                    borderTopColor: 'var(--accent)',
                    animation: 'spin 1s linear infinite'
                  }} />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>Analyzing resource...</span>
              </div>
              <div style={{ width: 200, height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: '60%', height: '100%', background: 'var(--accent)', borderRadius: 2, animation: 'shimmer 1.5s infinite' }} />
              </div>
            </div>
          ) : insight?.recommendations?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(52,211,153,0.1) 100%)', borderRadius: 10, border: '1px solid var(--accent-border)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                  {insight.recommendations.length} AI Recommendation{insight.recommendations.length !== 1 ? 's' : ''} Found
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
                  {resource.optimization || 'Optimization Available'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {insight.recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '16px',
                      background: 'var(--bg-surface)',
                      borderRadius: 12,
                      border: '1px solid var(--border)',
                      borderLeft: `4px solid ${rec.priority === 1 ? '#ef4444' : rec.priority === 2 ? '#f59e0b' : '#22c55e'}`
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: rec.priority === 1 ? 'rgba(239,68,68,0.1)' : rec.priority === 2 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                        color: rec.priority === 1 ? '#ef4444' : rec.priority === 2 ? '#f59e0b' : '#22c55e'
                      }}>
                        {rec.priority === 1 ? 'High' : rec.priority === 2 ? 'Medium' : 'Low'} Priority
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'capitalize' }}>{rec.category}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>{rec.action}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>{rec.rationale}</div>
                    {rec.estimatedSavings > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: 8 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#22c55e' }}>
                          Save ${rec.estimatedSavings.toLocaleString()}/mo ({rec.savingsPercent}% reduction)
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0', color: 'var(--text-3)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4M12 8h.01"/>
              </svg>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No recommendations available</div>
              <div style={{ fontSize: 12 }}>This resource appears to be optimally configured</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIInsightsModal;
