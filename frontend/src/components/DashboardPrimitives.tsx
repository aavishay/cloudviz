import React from 'react';

interface CardProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Card({ title, icon, children, style }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 16,
        ...style
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon && <span style={{ color: 'var(--text-2)' }}>{icon}</span>}
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  alert?: boolean;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, alert, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: alert ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface)',
        border: `1px solid ${alert ? 'var(--danger)' : 'var(--border)'}`,
        borderRadius: 10,
        padding: 12,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }}
    >
      {icon && <div style={{ flexShrink: 0 }}>{icon}</div>}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: alert ? 'var(--danger)' : 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>
          {value}
        </div>
      </div>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  color?: string;
  height?: number;
}

export function ProgressBar({ value, color = 'var(--accent)', height = 6 }: ProgressBarProps) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      style={{
        width: '100%',
        height,
        background: 'var(--bg-surface)',
        borderRadius: height / 2,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          width: `${clampedValue}%`,
          height: '100%',
          background: color,
          borderRadius: height / 2,
          transition: 'width 0.3s ease'
        }}
      />
    </div>
  );
}

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
}

export function MiniChart({ data, color = 'var(--accent)', height = 40 }: MiniChartProps) {
  if (data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  // Create SVG path
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  // Create area path (close the bottom)
  const areaPoints = `0,100 ${points} 100,100`;

  return (
    <div style={{ width: '100%', height }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill={`${color}20`}
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
