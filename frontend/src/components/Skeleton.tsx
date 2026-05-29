import type { ReactNode } from 'react';

interface SkeletonCardProps {
  height?: number;
  width?: string | number;
  className?: string;
  children?: ReactNode;
}

export function SkeletonCard({ height = 120, width = '100%', className = '', children }: SkeletonCardProps) {
  return (
    <div
      className={`skeleton-card ${className}`}
      style={{
        height,
        width,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Shimmer animation */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.05) 50%, transparent 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s ease-in-out infinite',
          zIndex: 0
        }}
      />
      {children && (
        <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      )}
    </div>
  );
}

interface SkeletonTextProps {
  lines?: number;
  width?: string | string[];
  className?: string;
}

export function SkeletonText({ lines = 1, width = '100%', className = '' }: SkeletonTextProps) {
  const widths = Array.isArray(width) ? width : Array(lines).fill(width);

  return (
    <div className={`skeleton-text-container ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {widths.map((w, i) => (
        <div
          key={i}
          style={{
            height: 14,
            width: w,
            borderRadius: 4,
            background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s ease-in-out infinite',
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, columns = 6, className = '' }: SkeletonTableProps) {
  return (
    <div className={`skeleton-table ${className}`} style={{ width: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)'
      }}>
        {Array(columns).fill(null).map((_, i) => (
          <div
            key={`header-${i}`}
            style={{
              flex: i === 0 ? 2 : 1,
              height: 10,
              borderRadius: 3,
              background: 'var(--bg-hover)',
              opacity: 0.6
            }}
          />
        ))}
      </div>

      {/* Rows */}
      {Array(rows).fill(null).map((_, rowIdx) => (
        <div
          key={`row-${rowIdx}`}
          style={{
            display: 'flex',
            gap: 16,
            padding: '16px',
            borderBottom: '1px solid var(--border)',
            alignItems: 'center'
          }}
        >
          {Array(columns).fill(null).map((_, colIdx) => (
            <div
              key={`cell-${rowIdx}-${colIdx}`}
              style={{
                flex: colIdx === 0 ? 2 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              {colIdx === 0 ? (
                <>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                    animationDelay: `${rowIdx * 0.1}s`
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{
                      height: 14,
                      width: '70%',
                      borderRadius: 3,
                      background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.5s ease-in-out infinite',
                      animationDelay: `${rowIdx * 0.1 + 0.05}s`
                    }} />
                  </div>
                </>
              ) : colIdx === columns - 1 ? (
                <div style={{
                  height: 24,
                  width: 60,
                  borderRadius: 6,
                  background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: `${rowIdx * 0.1 + colIdx * 0.05}s`
                }} />
              ) : (
                <div style={{
                  height: 12,
                  width: colIdx === 2 ? '60%' : '80%',
                  borderRadius: 3,
                  background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s ease-in-out infinite',
                  animationDelay: `${rowIdx * 0.1 + colIdx * 0.05}s`
                }} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface SkeletonStatCardProps {
  className?: string;
}

export function SkeletonStatCard({ className = '' }: SkeletonStatCardProps) {
  return (
    <div
      className={`skeleton-stat-card ${className}`}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s ease-in-out infinite'
        }} />
        <div style={{
          height: 11,
          width: 100,
          borderRadius: 4,
          background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s ease-in-out infinite',
          animationDelay: '0.1s'
        }} />
      </div>

      <div style={{
        height: 36,
        width: '60%',
        borderRadius: 6,
        background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
        animationDelay: '0.2s'
      }} />

      <div style={{
        height: 12,
        width: '40%',
        borderRadius: 4,
        background: 'linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-surface) 50%, var(--bg-hover) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
        animationDelay: '0.3s'
      }} />
    </div>
  );
}

// Full dashboard skeleton
export function SkeletonDashboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16
      }}>
        {Array(4).fill(null).map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>

      {/* Charts row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 16
      }}>
        <SkeletonCard height={300} />
        <SkeletonCard height={300} />
      </div>

      {/* Table */}
      <SkeletonCard height={400}>
        <SkeletonTable rows={6} columns={7} />
      </SkeletonCard>
    </div>
  );
}

// Add CSS animation keyframes
export function SkeletonStyles() {
  return (
    <style>{`
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
    `}</style>
  );
}

export default {
  Card: SkeletonCard,
  Text: SkeletonText,
  Table: SkeletonTable,
  StatCard: SkeletonStatCard,
  Dashboard: SkeletonDashboard,
  Styles: SkeletonStyles
};
