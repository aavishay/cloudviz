import { useState, useMemo } from 'react';
import { Sparkline } from './Sparkline';

interface CostCardProps {
  title: string;
  cost: number;
  previousCost?: number;
  trend?: number;
  trendData?: number[];
  resourceGroup?: string;
  resourceType?: string;
  location?: string;
  onClick?: () => void;
  index?: number;
}

export function CostCard({
  title,
  cost,
  previousCost = 0,
  trend,
  trendData,
  resourceGroup,
  resourceType,
  location,
  onClick,
  index = 0
}: CostCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isAnimating, setIsAnimating] = useState(true);

  // Calculate derived values
  const { percentChange, trendDirection } = useMemo(() => {
    const change = cost - previousCost;
    const percentChange = previousCost > 0 ? (change / previousCost) * 100 : 0;
    const trendDirection = trend !== undefined
      ? (trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral')
      : (change > 0 ? 'up' : change < 0 ? 'down' : 'neutral');

    return { percentChange, trendDirection };
  }, [cost, previousCost, trend]);

  // Format cost display
  const formattedCost = useMemo(() => {
    if (cost >= 1000000) {
      return `$${(cost / 1000000).toFixed(1)}M`;
    } else if (cost >= 1000) {
      return `$${(cost / 1000).toFixed(0)}k`;
    }
    return `$${cost.toFixed(0)}`;
  }, [cost]);

  // Stop animation after initial mount
  useState(() => {
    const timer = setTimeout(() => setIsAnimating(false), 1000);
    return () => clearTimeout(timer);
  });

  const getTrendColor = (direction: string) => {
    switch (direction) {
      case 'up': return '#f43f5e';
      case 'down': return '#10b981';
      default: return '#64748b';
    }
  };

  const trendColor = getTrendColor(trendDirection);
  const showTrend = trendDirection !== 'neutral' || percentChange !== 0;

  return (
    <div
      className="cost-card"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 20,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: isHovered
          ? '0 8px 30px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--accent-border)'
          : '0 2px 8px rgba(0, 0, 0, 0.2)',
        animation: `cardFadeIn 0.4s ease ${index * 0.05}s backwards`,
        minWidth: 260
      }}
    >
      {/* Top accent gradient */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${trendColor} 0%, transparent 100%)`,
        opacity: isHovered ? 1 : 0.6,
        transition: 'opacity 0.2s ease'
      }} />

      {/* Subtle shimmer effect on hover */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.02) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        animation: isHovered ? 'shimmer 2s ease-in-out infinite' : undefined,
        opacity: isHovered ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: 'none'
      }} />

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-1)',
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {title}
          </h3>
          {(resourceGroup || resourceType) && (
            <div style={{
              display: 'flex',
              gap: 8,
              marginTop: 4,
              flexWrap: 'wrap'
            }}>
              {resourceGroup && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-3)',
                  background: 'var(--bg-surface)',
                  padding: '2px 6px',
                  borderRadius: 4
                }}>
                  {resourceGroup}
                </span>
              )}
              {location && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--cyan)',
                  background: 'rgba(6, 182, 212, 0.1)',
                  padding: '2px 6px',
                  borderRadius: 4
                }}>
                  {location}
                </span>
              )}
            </div>
          )}
        </div>

        {showTrend && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 12,
            background: trendDirection === 'down'
              ? 'rgba(16, 185, 129, 0.1)'
              : trendDirection === 'up'
                ? 'rgba(244, 63, 94, 0.1)'
                : 'var(--bg-surface)',
            fontSize: 11,
            fontWeight: 700,
            color: trendColor,
            whiteSpace: 'nowrap'
          }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={trendColor} strokeWidth={2.5}>
              {trendDirection === 'up' ? (
                <path d="M12 19V5M5 12l7-7 7 7" />
              ) : trendDirection === 'down' ? (
                <path d="M12 5v14M19 12l-7 7-7-7" />
              ) : (
                <path d="M5 12h14" />
              )}
            </svg>
            {Math.abs(percentChange).toFixed(0)}%
          </div>
        )}
      </div>

      {/* Cost Amount */}
      <div style={{ marginBottom: 12 }}>
        <span style={{
          fontSize: 32,
          fontWeight: 900,
          letterSpacing: '-0.04em',
          color: 'var(--text-1)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          transition: 'all 0.3s ease'
        }}>
          {formattedCost}
        </span>
        {cost > 0 && cost < 1 && (
          <span style={{
            fontSize: 12,
            color: 'var(--text-3)',
            marginLeft: 4
          }}>
            /mo
          </span>
        )}
      </div>

      {/* Sparkline or comparison */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12
      }}>
        {trendData && trendData.length > 1 ? (
          <Sparkline
            data={trendData}
            width={100}
            height={28}
            showArea={true}
            animated={isAnimating}
          />
        ) : previousCost > 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-3)'
          }}>
            <span>Was: ${previousCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            New resource
          </span>
        )}

        {onClick && (
          <button
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: isHovered ? 'var(--accent)' : 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: isHovered ? '#fff' : 'var(--text-2)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
          >
            View Details
          </button>
        )}
      </div>

      <style>{`
        @keyframes cardFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}

export default CostCard;
