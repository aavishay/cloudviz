import { useMemo, useState } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  showArea?: boolean;
  animated?: boolean;
  interactive?: boolean;
}

export function Sparkline({
  data,
  width = 72,
  height = 22,
  showArea = true,
  animated = true,
  interactive = true
}: SparklineProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const { validData, points, min, range, trendUp } = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length < 2) {
      return { validData: [], points: '', min: 0, range: 1, trendUp: true };
    }

    const filtered = data.filter(v => typeof v === 'number' && isFinite(v) && !isNaN(v));
    if (filtered.length < 2) {
      return { validData: [], points: '', min: 0, range: 1, trendUp: true };
    }

    const minVal = Math.min(...filtered);
    const maxVal = Math.max(...filtered);
    const rangeVal = maxVal - minVal || 1;

    // Generate points
    const pts = filtered.map((v, i) => {
      const x = filtered.length < 2 ? width / 2 : (i / (filtered.length - 1)) * width;
      const y = height - ((v - minVal) / rangeVal) * height;
      return `${x},${y}`;
    }).join(' ');

    const lastVal = filtered[filtered.length - 1];
    const prevVal = filtered[filtered.length - 2] ?? lastVal;

    return {
      validData: filtered,
      points: pts,
      min: minVal,
      max: maxVal,
      range: rangeVal,
      trendUp: lastVal >= prevVal
    };
  }, [data, width, height]);

  // Generate area path - must be defined before early return to satisfy hooks rules
  const areaPath = useMemo(() => {
    if (!showArea || points === '') return '';
    const pts = points.split(' ');
    const firstPt = pts[0];
    const lastPt = pts[pts.length - 1];
    return `${firstPt} ${points} ${lastPt.split(',')[0]},${height} ${firstPt.split(',')[0]},${height}`;
  }, [points, showArea, height]);

  if (validData.length === 0) return null;

  const color = trendUp ? '#10b981' : '#f43f5e';
  const glowColor = trendUp ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)';

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive || validData.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const index = Math.round((x / width) * (validData.length - 1));
    const clampedIndex = Math.max(0, Math.min(validData.length - 1, index));

    setHoverIndex(clampedIndex);
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  // Calculate hover point position
  const hoverPoint = hoverIndex !== null ? {
    x: validData.length < 2 ? width / 2 : (hoverIndex / (validData.length - 1)) * width,
    y: height - ((validData[hoverIndex] - min) / range) * height
  } : null;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <svg
        width={width}
        height={height}
        style={{
          overflow: 'visible',
          flexShrink: 0,
          cursor: interactive ? 'crosshair' : 'default'
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id={`sparklineGradient-${width}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>

          {animated && (
            <>
              <filter id={`sparklineGlow-${width}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <clipPath id={`sparklineClip-${width}`}>
                <rect x="0" y="0" width={width} height={height}>
                  {animated && (
                    <animate
                      attributeName="width"
                      from="0"
                      to={width}
                      dur="0.8s"
                      fill="freeze"
                      calcMode="easeOut"
                    />
                  )}
                </rect>
              </clipPath>
            </>
          )}
        </defs>

        {/* Area fill */}
        {showArea && areaPath && (
          <polygon
            points={areaPath}
            fill={`url(#sparklineGradient-${width})`}
            clipPath={animated ? `url(#sparklineClip-${width})` : undefined}
          />
        )}

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#sparklineGlow-${width})`}
          clipPath={animated ? `url(#sparklineClip-${width})` : undefined}
          style={{
            filter: `drop-shadow(0 0 3px ${glowColor})`,
            opacity: animated ? undefined : 1
          }}
        />

        {/* Hover indicator */}
        {interactive && hoverPoint && (
          <>
            <circle
              cx={hoverPoint.x}
              cy={hoverPoint.y}
              r={3}
              fill={color}
              stroke="white"
              strokeWidth={1.5}
              style={{
                animation: 'fadeIn 0.1s ease'
              }}
            />
            <line
              x1={hoverPoint.x}
              y1={0}
              x2={hoverPoint.x}
              y2={height}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="2,2"
              opacity={0.3}
            />
          </>
        )}
      </svg>

      {/* Tooltip */}
      {interactive && hoverIndex !== null && validData[hoverIndex] !== undefined && (
        <div
          style={{
            position: 'fixed',
            left: mousePos.x,
            top: mousePos.y - 40,
            transform: 'translateX(-50%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 6,
            padding: '6px 10px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            pointerEvents: 'none',
            animation: 'fadeSlideUp 0.1s ease'
          }}
        >
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: color,
            fontFamily: 'var(--font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            ${validData[hoverIndex].toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          {hoverIndex > 0 && (
            <div style={{
              fontSize: 9,
              color: 'var(--text-3)',
              marginTop: 2
            }}>
              {((validData[hoverIndex] - validData[hoverIndex - 1]) / validData[hoverIndex - 1] * 100) > 0 ? '+' : ''}
              {((validData[hoverIndex] - validData[hoverIndex - 1]) / validData[hoverIndex - 1] * 100).toFixed(1)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Sparkline;
