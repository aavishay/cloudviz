// ─── Commitments tab ─────────────────────────────────────────────────────────────────

import type { Dispatch, SetStateAction } from 'react';

export interface CommitmentsTabProps {
  // Response of /api/costs/commitments (untyped in the app).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commitmentsData: any;
  commitmentsLoading: boolean;
  commitmentsError: string | null;
  commitmentsPeriod: number;
  setCommitmentsPeriod: Dispatch<SetStateAction<number>>;
  refetchCommitments: () => void;
}

export function CommitmentsTab({ commitmentsData, commitmentsLoading, commitmentsError, commitmentsPeriod, setCommitmentsPeriod, refetchCommitments }: CommitmentsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Commitments Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139 92 246 / 0.3)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
          </div>
          <div>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>RI & Savings Plan Purchases</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 12 }}>
              {commitmentsData?.summary ? `$${commitmentsData.summary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} total · ${commitmentsData.summary.count} purchases` : 'Loading...'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[30, 90, 180, 365].map(days => {
              const isActive = commitmentsPeriod === days;
              return (
                <button
                  key={days}
                  onClick={() => setCommitmentsPeriod(days)}
                  style={{
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    border: '1px solid',
                    borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                    borderRadius: 6,
                    background: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? 'white' : 'var(--text-2)',
                    cursor: 'pointer'
                  }}
                >
                  {days >= 365 ? '1y' : days >= 180 ? '6m' : days >= 90 ? '3m' : '1m'}
                </button>
              );
            })}
          </div>
          <button
            className="btn"
            onClick={refetchCommitments}
            disabled={commitmentsLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: commitmentsLoading ? 'spin 0.8s linear infinite' : 'none' }}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {commitmentsLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12, color: 'var(--text-2)', fontSize: 13 }}>
          <div className="spinner" />
          Loading commitments data...
        </div>
      )}

      {!commitmentsLoading && commitmentsError && (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'rgba(239,68,68,0.05)', border: '1px solid var(--danger)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" style={{ marginBottom: 8 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)', marginBottom: 8 }}>{commitmentsError}</div>
          <button className="btn" onClick={refetchCommitments}>Try Again</button>
        </div>
      )}

      {/* Summary by Type */}
      {!commitmentsLoading && commitmentsData?.summary?.byType?.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 16 }}>By Commitment Type</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {commitmentsData.summary.byType.map((t: any, i: number) => (
              <div key={i} style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.type}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>{t.count} purchases · ${t.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Purchases Table */}
      {!commitmentsLoading && commitmentsData?.purchases?.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Purchase Details</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{commitmentsData.purchases.length} items</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {[
                    { key: 'date', label: 'Date' },
                    { key: 'commitmentType', label: 'Type' },
                    { key: 'product', label: 'Product' },
                    { key: 'category', label: 'Category' },
                    { key: 'cost', label: 'Cost' },
                  ].map(col => (
                    <th
                      key={col.key}
                      style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {commitmentsData.purchases.slice(0, 100).map((purchase: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', color: 'var(--text-1)', fontWeight: 500, whiteSpace: 'nowrap' }}>{purchase.date}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-1)' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: purchase.commitmentType === 'Reserved Instance' ? 'rgba(139,92,246,0.1)' : 'rgba(245,158,11,0.1)',
                        color: purchase.commitmentType === 'Reserved Instance' ? '#8b5cf6' : '#f59e0b'
                      }}>
                        {purchase.commitmentType || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{purchase.product || '—'}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{purchase.category || '—'}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--accent)', fontWeight: 700 }}>
                      ${purchase.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!commitmentsLoading && !commitmentsError && (!commitmentsData?.purchases || commitmentsData.purchases.length === 0) && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          No Reserved Instance or Savings Plan purchases found for the selected period.
        </div>
      )}
    </div>
  );
}
