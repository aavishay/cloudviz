import { useState, useMemo, useRef } from 'react';

// ─── RG Trends Chart ────────────────────────────────────────────────────────────

const RG_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#f97316','#84cc16'];

interface RGTrendsChartProps {
  data: any;
  period: 7 | 14 | 30;
  onPeriodChange: (p: 7 | 14 | 30) => void;
}

export function RGTrendsChart({ data, period, onPeriodChange }: RGTrendsChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [scaleX, setScaleX] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const dates: string[] = data?.dates ?? [];
  const groups: Array<{ name: string; dailyCosts: number[]; totalAbs: number }> = data?.groups ?? [];

  const W = 800, H = 260;
  const padL = 58, padR = 16, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const visible = groups.filter(g => !hidden.has(g.name));

  // Calculate stacked values for each day
  const stackedData = useMemo(() => {
    return dates.map((_, dayIdx) => {
      const dayValues = visible.map(g => ({ name: g.name, value: g.dailyCosts[dayIdx] ?? 0 }));
      const positive = dayValues.filter(v => v.value > 0).sort((a, b) => b.value - a.value);
      const negative = dayValues.filter(v => v.value < 0).sort((a, b) => a.value - b.value);

      let posY = 0;
      const posStack = positive.map(v => {
        const bottom = posY;
        const top = posY + v.value;
        posY = top;
        return { ...v, bottom, top };
      });

      let negY = 0;
      const negStack = negative.map(v => {
        const top = negY;
        const bottom = negY + v.value;
        negY = bottom;
        return { ...v, bottom, top };
      });

      return { dayIdx, posStack, negStack, posTotal: posY, negTotal: negY };
    });
  }, [dates, visible]);

  const allTotals = stackedData.flatMap(d => [d.posTotal, Math.abs(d.negTotal)]);
  const rawMax = Math.max(...allTotals, 1);
  const yMax = rawMax * 1.1;
  const yMin = -yMax;
  const yRange = yMax - yMin;
  const zeroY = padT + plotH * (yMax / yRange);

  const barWidth = dates.length === 0 ? 0 : dates.length > 14 ? plotW / dates.length * 0.7 : plotW / dates.length * 0.6;
  const xOf = (i: number) => dates.length < 2 ? padL + plotW / 2 : padL + (i + 0.5) * (plotW / dates.length);
  const yOf = (v: number) => padT + plotH * (1 - (v - yMin) / yRange);

  const fmtCost = (v: number) => {
    const abs = Math.abs(v);
    const s = abs >= 1000 ? `$${(abs/1000).toFixed(1)}k` : `$${abs.toFixed(0)}`;
    return v < 0 ? `−${s}` : `+${s}`;
  };
  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleSVGMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!svgRef.current || dates.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = rect.width / W;
    setScaleX(scale);
    const scaleXValue = W / rect.width;
    const x = (e.clientX - rect.left) * scaleXValue;
    const idx = Math.floor(((x - padL) / plotW) * dates.length);
    setHoverIdx(Math.max(0, Math.min(dates.length - 1, idx)));
  };

  const yTicks = (() => {
    const count = 5;
    const step = yRange / (count - 1);
    return Array.from({ length: count }, (_, i) => yMin + step * i);
  })();

  const shortName = (n: string) => n.length > 22 ? n.slice(0, 21) + '…' : n;

  const getGroupColor = (name: string) => {
    const idx = groups.findIndex(g => g.name === name);
    return RG_COLORS[idx % RG_COLORS.length];
  };

  const hoverInfo = useMemo(() => {
    if (hoverIdx === null) return null;
    const dayData = stackedData[hoverIdx];
    if (!dayData) return null;
    const allSegments = [...dayData.posStack, ...dayData.negStack];
    const total = dayData.posTotal + dayData.negTotal;
    return { ...dayData, allSegments, total, date: dates[hoverIdx] };
  }, [hoverIdx, stackedData, dates]);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(99,102,241,0.25)' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>Resource Group Cost Trends</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>Net daily spend change by resource group ($/day)</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([7, 14, 30] as const).map(p => (
            <button key={p} onClick={() => onPeriodChange(p)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: period === p ? 'var(--accent)' : 'var(--bg-card)', color: period === p ? 'white' : 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: '16px 18px 8px', position: 'relative' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
          {/* Y-axis grid + labels */}
          {yTicks.map((v, i) => {
            const y = yOf(v);
            const isZero = Math.abs(v) < yRange * 0.01;
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={isZero ? 'var(--text-3)' : 'var(--border)'} strokeWidth={isZero ? 1.5 : 0.5} strokeDasharray={isZero ? '0' : '3,3'} opacity={isZero ? 0.8 : 0.5} />
                <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
                  {v >= 0 ? `+$${Math.abs(v) >= 1000 ? (Math.abs(v)/1000).toFixed(0)+'k' : Math.abs(v).toFixed(0)}` : `-$${Math.abs(v) >= 1000 ? (Math.abs(v)/1000).toFixed(0)+'k' : Math.abs(v).toFixed(0)}`}
                </text>
              </g>
            );
          })}

          {/* Zero baseline */}
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--text-2)" strokeWidth={1.5} opacity={0.6} />

          {/* X-axis labels */}
          {dates.map((d, i) => {
            const showEvery = dates.length > 14 ? Math.ceil(dates.length / 7) : 1;
            if (i % showEvery !== 0 && i !== dates.length - 1) return null;
            return (
              <text key={i} x={xOf(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--text-3)">{fmtDate(d)}</text>
            );
          })}

          {/* Stacked Bars */}
          {stackedData.map((day) => {
            const x = xOf(day.dayIdx);
            const allSegments = [...day.posStack, ...day.negStack];
            return allSegments.map((seg) => {
              const color = getGroupColor(seg.name);
              const yBottom = yOf(seg.bottom);
              const yTop = yOf(seg.top);
              const height = Math.abs(yBottom - yTop);
              const isHovered = hoverGroup === seg.name;
              const isDimmed = hoverGroup && hoverGroup !== seg.name;

              return (
                <rect
                  key={`${day.dayIdx}-${seg.name}`}
                  x={x - barWidth / 2}
                  y={Math.min(yTop, yBottom)}
                  width={barWidth}
                  height={Math.max(height, 1)}
                  fill={color}
                  opacity={isDimmed ? 0.3 : isHovered ? 1 : 0.85}
                  style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
                  onMouseEnter={() => setHoverGroup(seg.name)}
                  onMouseLeave={() => setHoverGroup(null)}
                />
              );
            });
          })}

          {/* Hover highlight line */}
          {hoverIdx !== null && (
            <line
              x1={xOf(hoverIdx) - barWidth/2 - 4}
              y1={padT}
              x2={xOf(hoverIdx) - barWidth/2 - 4}
              y2={padT + plotH}
              stroke="var(--text-3)"
              strokeWidth={1}
              strokeDasharray="3,2"
              opacity={0.4}
            />
          )}

          {/* Invisible mouse-capture rect */}
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="transparent"
            onMouseMove={handleSVGMouseMove}
            onMouseLeave={() => { setHoverIdx(null); setHoverGroup(null); }} />
        </svg>

        {/* Hover tooltip */}
        {hoverInfo && (() => {
          const tipX = xOf(hoverIdx!) * scaleX;
          const tipLeft = tipX + 16;
          const maxLeft = (W * scaleX) - 180;

          return (
            <div style={{
              position: 'absolute', top: 24, left: Math.min(tipLeft, maxLeft),
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 14px', pointerEvents: 'none', zIndex: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.25)', minWidth: 160
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                {fmtDate(hoverInfo.date)}
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500, marginLeft: 8 }}>
                  Net: <span style={{ color: hoverInfo.total >= 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 700 }}>{fmtCost(hoverInfo.total)}</span>
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {hoverInfo.allSegments.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>No changes</div>
                )}
                {hoverInfo.allSegments.map((seg, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: getGroupColor(seg.name), flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName(seg.name)}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: seg.value >= 0 ? 'var(--danger)' : 'var(--accent)', flexShrink: 0 }}>{fmtCost(seg.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 18px 14px' }}>
        {groups.map((g, gi) => {
          const isHidden = hidden.has(g.name);
          const color = RG_COLORS[gi % RG_COLORS.length];
          const isHovered = hoverGroup === g.name;
          return (
            <button key={gi} onClick={() => setHidden(prev => {
              const next = new Set(prev);
              if (next.has(g.name)) {
                next.delete(g.name);
              } else {
                next.add(g.name);
              }
              return next;
            })} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
              borderRadius: 6, border: `1px solid ${isHidden ? 'var(--border)' : isHovered ? color : color + '55'}`,
              background: isHidden ? 'transparent' : isHovered ? color + '30' : color + '15',
              cursor: 'pointer', opacity: isHidden ? 0.45 : 1, transition: 'all 0.15s'
            }}
            onMouseEnter={() => setHoverGroup(g.name)}
            onMouseLeave={() => setHoverGroup(null)}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: isHidden ? 'var(--text-3)' : color }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: isHidden ? 'var(--text-3)' : 'var(--text-2)', whiteSpace: 'nowrap' }}>{shortName(g.name)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default RGTrendsChart;
