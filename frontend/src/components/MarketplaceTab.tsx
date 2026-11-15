// ─── Marketplace tab ─────────────────────────────────────────────────────────────────

import type { Dispatch, SetStateAction } from 'react';

export interface MarketplaceTabProps {
  // Response of /api/costs/marketplace (untyped in the app).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  marketplaceData: any;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  marketplacePeriod: number;
  setMarketplacePeriod: Dispatch<SetStateAction<number>>;
  refetchMarketplace: () => void;
}

export function MarketplaceTab({ marketplaceData, marketplaceLoading, marketplaceError, marketplacePeriod, setMarketplacePeriod, refetchMarketplace }: MarketplaceTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Marketplace Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(245 158 11 / 0.3)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 3h18v18H3z" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>
          </div>
          <div>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>Marketplace Purchases</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 12 }}>
              {marketplaceData?.summary ? `$${marketplaceData.summary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} total · ${marketplaceData.summary.count} purchases` : 'Loading...'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: 4 }}>
            {[7, 30, 90].map(days => {
              const isActive = marketplacePeriod === days;
              return (
                <button
                  key={days}
                  onClick={() => setMarketplacePeriod(days)}
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
                  {days}d
                </button>
              );
            })}
          </div>
          <button
            className="btn"
            onClick={refetchMarketplace}
            disabled={marketplaceLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: marketplaceLoading ? 'spin 0.8s linear infinite' : 'none' }}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {marketplaceLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12, color: 'var(--text-2)', fontSize: 13 }}>
          <div className="spinner" />
          Loading marketplace data...
        </div>
      )}

      {!marketplaceLoading && marketplaceError && (
        <div className="card" style={{ padding: 24, textAlign: 'center', background: 'rgba(239,68,68,0.05)', border: '1px solid var(--danger)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" style={{ marginBottom: 8 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)', marginBottom: 8 }}>{marketplaceError}</div>
          <button className="btn" onClick={refetchMarketplace}>Try Again</button>
        </div>
      )}

      {!marketplaceLoading && !marketplaceError && marketplaceData?.summary?.spikeDays?.length > 0 && (
        <div className="card" style={{ padding: 16, background: 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.05) 100%)', border: '1px solid var(--danger)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>Cost Spike Days Detected</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {marketplaceData.summary.spikeDays.map((spike: any, i: number) => (
              <div key={i} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{spike.date}</div>
                <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700 }}>${spike.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({spike.ratio.toFixed(1)}x avg)</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary by Publisher */}
      {!marketplaceLoading && marketplaceData?.summary?.byPublisher?.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 16 }}>Top Publishers</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {marketplaceData.summary.byPublisher.slice(0, 6).map((pub: any, i: number) => (
              <div key={i} style={{ padding: 12, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pub.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>{pub.count} purchases · ${pub.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Purchases Table */}
      {!marketplaceLoading && marketplaceData?.purchases?.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Purchase Details</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{marketplaceData.purchases.length} items</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {[
                    { key: 'date', label: 'Date' },
                    { key: 'resourceName', label: 'Resource' },
                    { key: 'resourceGroup', label: 'Resource Group' },
                    { key: 'publisher', label: 'Publisher' },
                    { key: 'product', label: 'Product' },
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
                {marketplaceData.purchases.slice(0, 100).map((purchase: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', color: 'var(--text-1)', fontWeight: 500, whiteSpace: 'nowrap' }}>{purchase.date}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-1)' }}>{purchase.resourceName || '—'}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{purchase.resourceGroup || '—'}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{purchase.publisher || '—'}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{purchase.product || '—'}</td>
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

      {!marketplaceLoading && !marketplaceError && (!marketplaceData?.purchases || marketplaceData.purchases.length === 0) && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          No marketplace purchases found for the selected period.
        </div>
      )}
    </div>
  );
}
