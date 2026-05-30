import { useState, useEffect, useRef } from 'react';

interface ScoreRingProps {
  score: number;
  size?: number;
  showTooltip?: boolean;
  tooltipText?: string;
  animated?: boolean;
}

export function ScoreRing({
  score,
  size = 30,
  showTooltip = true,
  tooltipText,
  animated = true
}: ScoreRingProps) {
  const clampedScore = typeof score === 'number' && Number.isFinite(score)
    ? Math.max(0, Math.min(100, score))
    : 0;

  const [displayScore, setDisplayScore] = useState(() => animated ? 0 : clampedScore);
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // Animate score on mount and when score changes
  useEffect(() => {
    if (!animated) {
      if (displayScore !== clampedScore) {
        setDisplayScore(clampedScore);
      }
      return;
    }

    const duration = 600;
    const startTime = Date.now();
    const startValue = displayScore;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + (clampedScore - startValue) * easeOut);
      setDisplayScore(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedScore, animated]);

  // Calculate dimensions
  const strokeWidth = size * 0.083; // 2.5 for size 30
  const r = (size - strokeWidth) / 2 - 1;
  const circ = 2 * Math.PI * r;
  const center = size / 2;
  const fontSize = size * 0.233; // 7 for size 30

  // Color interpolation based on score
  const getColor = (s: number) => {
    if (s >= 80) return '#10b981'; // emerald-500
    if (s >= 50) return '#f59e0b'; // amber-500
    return '#f43f5e'; // rose-500
  };

  // Get status text
  const getStatusText = (s: number) => {
    if (s >= 90) return 'Excellent - Well optimized resource';
    if (s >= 80) return 'Good - Efficient resource utilization';
    if (s >= 60) return 'Fair - Minor optimization possible';
    if (s >= 40) return 'Poor - Optimization recommended';
    return 'Critical - Immediate attention required';
  };

  const color = getColor(clampedScore);
  const glowColor = color.replace(')', ' / 0.4)').replace('rgb', 'rgba');

  const handleMouseEnter = () => {
    setIsHovered(true);
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 10
      });
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        className="score-ring"
        style={{
          flexShrink: 0,
          filter: `drop-shadow(0 0 ${isHovered ? 8 : 4}px ${glowColor})`,
          cursor: showTooltip ? 'help' : 'default',
          transition: 'filter 0.2s ease'
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={strokeWidth}
          opacity={0.3}
        />

        {/* Progress arc with gradient */}
        <defs>
          <linearGradient id={`scoreGradient-${clampedScore}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={clampedScore >= 50 ? '#10b981' : '#f43f5e'} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>

        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={`url(#scoreGradient-${clampedScore})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circ}
          strokeDashoffset={circ - (displayScore / 100) * circ}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
          style={{
            transition: animated ? 'stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1)' : undefined
          }}
        />

        {/* Score text */}
        <text
          x={center}
          y={center}
          dominantBaseline="central"
          textAnchor="middle"
          style={{
            fontSize: fontSize,
            fontWeight: 900,
            fill: color,
            fontFamily: 'var(--font-mono, monospace)',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {displayScore}
        </text>
      </svg>

      {/* Tooltip */}
      {showTooltip && isHovered && (
        <div
          style={{
            position: 'fixed',
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translate(-50%, -100%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: '8px 12px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1000,
            pointerEvents: 'none',
            animation: 'fadeSlideUp 0.15s ease',
            maxWidth: 200,
            textAlign: 'center'
          }}
        >
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: color,
            marginBottom: 4
          }}>
            Score: {clampedScore}/100
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-2)',
            lineHeight: 1.4
          }}>
            {tooltipText || getStatusText(clampedScore)}
          </div>
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: `6px solid var(--border-strong)`
          }} />
        </div>
      )}
    </div>
  );
}

export default ScoreRing;
