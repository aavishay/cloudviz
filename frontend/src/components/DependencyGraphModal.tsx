import { useState, useEffect, useMemo } from 'react';
import type { AzureResource, DependencyGraph } from './types';
import { friendlyType } from './utils';

// ─── DependencyGraphModal Component ──────────────────────────────────────────────────────────

interface DependencyGraphModalProps {
  resource: AzureResource;
  onClose: () => void;
  onResourceClick?: (resource: AzureResource) => void;
  allResources: AzureResource[];
}

function generateDependencySVG(graph: DependencyGraph, resource: AzureResource): string {
  const width = 800;
  const height = 600;
  const padding = 60;

  // Color scheme based on theme
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const bgColor = isDark ? '#0a0a14' : '#fafafa';
  const textColor = isDark ? '#e2e8f0' : '#1a1a2e';
  const secondaryText = isDark ? '#94a3b8' : '#64748b';
  const accentColor = '#3b82f6';
  const warningColor = '#f59e0b';
  const borderColor = isDark ? '#2d3748' : '#e2e8f0';

  // Calculate node positions - radial layout
  const centerX = width / 2;
  const centerY = height / 2;

  // Build nodes array
  const nodes: Array<{ id: string; name: string; type: string; x: number; y: number; color: string; relationship?: string }> = [];

  // Center node (main resource)
  nodes.push({
    id: resource.id,
    name: resource.name,
    type: resource.type,
    x: centerX,
    y: centerY,
    color: accentColor
  });

  // Dependency nodes (left side)
  const deps = graph.dependencies || [];
  const depRadius = Math.min(200, (height - 2 * padding) / Math.max(1, deps.length) * 0.8);
  deps.forEach((dep, i) => {
    const angle = deps.length === 1 ? Math.PI : Math.PI * 0.25 + (Math.PI * 0.5 * i / Math.max(1, deps.length - 1));
    nodes.push({
      id: dep.id,
      name: dep.name,
      type: dep.type,
      x: centerX + Math.cos(angle) * 180,
      y: centerY + Math.sin(angle) * depRadius - (deps.length * 20),
      color: warningColor,
      relationship: dep.relationship
    });
  });

  // Dependent nodes (right side)
  const depend = graph.dependents || [];
  const depenRadius = Math.min(200, (height - 2 * padding) / Math.max(1, depend.length) * 0.8);
  depend.forEach((dep, i) => {
    const angle = depend.length === 1 ? 0 : -Math.PI * 0.25 + (Math.PI * 0.5 * i / Math.max(1, depend.length - 1));
    nodes.push({
      id: dep.id,
      name: dep.name,
      type: dep.type,
      x: centerX + Math.cos(angle) * 180,
      y: centerY + Math.sin(angle) * depenRadius + (depend.length * 20),
      color: warningColor,
      relationship: dep.relationship
    });
  });

  // Generate SVG content
  const lines: string[] = [];

  // Draw connections
  deps.forEach((dep) => {
    const targetNode = nodes.find(n => n.id === dep.id);
    if (targetNode) {
      lines.push(`
        <line x1="${targetNode.x}" y1="${targetNode.y}" x2="${centerX}" y2="${centerY}"
              stroke="${borderColor}" stroke-width="2" stroke-dasharray="5,5" />
        <circle cx="${(targetNode.x + centerX) / 2}" cy="${(targetNode.y + centerY) / 2}" r="3" fill="${warningColor}" />
      `);
    }
  });

  depend.forEach((dep) => {
    const targetNode = nodes.find(n => n.id === dep.id);
    if (targetNode) {
      lines.push(`
        <line x1="${centerX}" y1="${centerY}" x2="${targetNode.x}" y2="${targetNode.y}"
              stroke="${borderColor}" stroke-width="2" />
        <polygon points="${targetNode.x - 8},${targetNode.y} ${targetNode.x - 16},${targetNode.y - 5} ${targetNode.x - 16},${targetNode.y + 5}"
                 fill="${accentColor}" />
      `);
    }
  });

  // Draw nodes
  const nodeCircles = nodes.map((node, i) => `
    <g>
      <circle cx="${node.x}" cy="${node.y}" r="24" fill="${bgColor}" stroke="${node.color}" stroke-width="3" />
      <text x="${node.x}" y="${node.y + 5}" text-anchor="middle"
            font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="600"
            fill="${node.color}">${i === 0 ? '★' : i <= deps.length ? '↓' : '↑'}</text>
      <text x="${node.x}" y="${node.y + 45}" text-anchor="middle"
            font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600"
            fill="${textColor}">${node.name.length > 20 ? node.name.substring(0, 20) + '...' : node.name}</text>
      <text x="${node.x}" y="${node.y + 60}" text-anchor="middle"
            font-family="system-ui, -apple-system, sans-serif" font-size="9"
            fill="${secondaryText}">${node.type.split('/').pop()?.substring(0, 25) || 'Resource'}</text>
    </g>
  `).join('\n');

  // Title and metadata
  const generatedAt = new Date().toLocaleString();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="${bgColor}" />

    <!-- Title -->
    <g transform="translate(${padding}, 30)">
      <text font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="${textColor}">
        Dependency Graph: ${resource.name}</text>
      <text y="20" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="${secondaryText}">
        ${graph.relationships} relationships • Generated: ${generatedAt}</text>
    </g>

    <!-- Legend -->
    <g transform="translate(${width - padding - 120}, 20)">
      <rect width="120" height="70" rx="8" fill="${bgColor}" stroke="${borderColor}" stroke-width="1" />
      <g transform="translate(10, 15)">
        <circle r="6" fill="${accentColor}" />
        <text x="15" y="4" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="${textColor}">Current Resource</text>
      </g>
      <g transform="translate(10, 35)">
        <circle r="6" fill="${warningColor}" />
        <text x="15" y="4" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="${textColor}">Dependencies</text>
      </g>
      <g transform="translate(10, 55)">
        <line x1="-6" y1="0" x2="6" y2="0" stroke="${borderColor}" stroke-width="2" />
        <text x="15" y="4" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="${textColor}">Connection</text>
      </g>
    </g>

    <!-- Graph content -->
    <g transform="translate(0, 50)">
      ${lines.join('\n')}
      ${nodeCircles}
    </g>

    <!-- Footer -->
    <text x="${width / 2}" y="${height - 15}" text-anchor="middle"
          font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="${secondaryText}">
      CloudViz • Azure Resource Dependency Visualization
    </text>
  </svg>`;
}

export function DependencyGraphModal({ resource, onClose, onResourceClick, allResources }: DependencyGraphModalProps) {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter dependencies and dependents based on search query
  const filteredDependencies = useMemo(() => {
    if (!graph || !searchQuery.trim()) return graph?.dependencies || [];
    const query = searchQuery.toLowerCase();
    return (graph.dependencies || []).filter(dep =>
      dep.name.toLowerCase().includes(query) ||
      dep.type.toLowerCase().includes(query) ||
      dep.relationship?.toLowerCase().includes(query)
    );
  }, [graph, searchQuery]);

  const filteredDependents = useMemo(() => {
    if (!graph || !searchQuery.trim()) return graph?.dependents || [];
    const query = searchQuery.toLowerCase();
    return (graph.dependents || []).filter(dep =>
      dep.name.toLowerCase().includes(query) ||
      dep.type.toLowerCase().includes(query) ||
      dep.relationship?.toLowerCase().includes(query)
    );
  }, [graph, searchQuery]);

  useEffect(() => {
    let isCancelled = false;

    fetch(`/api/dependencies?id=${encodeURIComponent(resource.id)}`)
      .then(r => {
        if (!r.ok) {
          return r.text().then(text => {
            throw new Error(`HTTP ${r.status}: ${text || 'Unknown error'}`);
          });
        }
        return r.json();
      })
      .then(data => {
        if (isCancelled) return;
        if (data.error) throw new Error(data.error);
        setGraph(data);
        setLoading(false);
      })
      .catch(e => {
        if (isCancelled) return;
        setError(e.message);
        setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [resource.id]);

  const getRelationshipColor = (rel: string) => {
    switch (rel) {
      case 'network': return 'var(--accent)';
      case 'storage': return 'var(--warning)';
      case 'parent': return 'var(--text-3)';
      default: return 'var(--text-2)';
    }
  };

  const getRelationshipIcon = (rel: string) => {
    switch (rel) {
      case 'network': return '🔗';
      case 'storage': return '💾';
      case 'parent': return '📁';
      default: return '🔗';
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: '85vh' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                <circle cx="12" cy="5" r="3" />
                <circle cx="5" cy="19" r="3" />
                <circle cx="19" cy="19" r="3" />
                <path d="M12 8v3M7 16h6m4 0h-6" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>Dependency Graph</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{resource.name}</div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="modal-body" style={{ overflow: 'auto' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" />
              <span style={{ color: 'var(--text-2)' }}>Analyzing dependencies...</span>
            </div>
          ) : error ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.5 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <div style={{ fontSize: 14 }}>Failed to load dependencies</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>{error}</div>
            </div>
          ) : graph ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Summary */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 120, padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dependencies</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--accent)', marginTop: 4 }}>{(graph.dependencies || []).length}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Resources this depends on</div>
                </div>
                <div style={{ flex: 1, minWidth: 120, padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dependents</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--warning)', marginTop: 4 }}>{(graph.dependents || []).length}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Resources depending on this</div>
                </div>
                <div style={{ flex: 1, minWidth: 120, padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-1)', marginTop: 4 }}>{graph.relationships}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>Relationships found</div>
                </div>
                {/* Export Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Export Diagram</div>
                  <button
                    onClick={() => {
                      // Generate SVG for the dependency graph
                      const svg = generateDependencySVG(graph, resource);
                      const blob = new Blob([svg], { type: 'image/svg+xml' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `dependency-graph-${resource.name.toLowerCase().replace(/\s+/g, '-')}.svg`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      color: 'var(--text-2)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.color = 'var(--accent)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.color = 'var(--text-2)';
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export SVG
                  </button>
                  <button
                    onClick={() => {
                      // Generate and convert SVG to PNG
                      const svg = generateDependencySVG(graph, resource);
                      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                      const url = URL.createObjectURL(svgBlob);
                      const img = new Image();
                      img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const scale = 2; // 2x for high resolution
                        canvas.width = 800 * scale;
                        canvas.height = 600 * scale;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#0a0a14' : '#fafafa';
                          ctx.fillRect(0, 0, canvas.width, canvas.height);
                          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                          const pngUrl = canvas.toDataURL('image/png');
                          const a = document.createElement('a');
                          a.href = pngUrl;
                          a.download = `dependency-graph-${resource.name.toLowerCase().replace(/\s+/g, '-')}.png`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }
                        URL.revokeObjectURL(url);
                      };
                      img.src = url;
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      color: 'var(--text-2)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.color = 'var(--accent)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.color = 'var(--text-2)';
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    Export PNG
                  </button>
                </div>
              </div>

              {/* Search/Filter and Export */}
              {((graph.dependencies || []).length + (graph.dependents || []).length) > 5 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <circle cx="11" cy="11" r="8" />
                      <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Filter dependencies by name, type, or relationship..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px 10px 40px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-1)',
                        fontSize: 13,
                        outline: 'none',
                        transition: 'all 0.2s ease'
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          padding: '4px 8px',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-3)',
                          cursor: 'pointer',
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        title="Clear filter"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {(searchQuery && graph) && (
                    <div style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                      Showing {filteredDependencies.length + filteredDependents.length} of {(graph.dependencies || []).length + (graph.dependents || []).length}
                    </div>
                  )}
                </div>
              )}

              {/* Dependencies (outbound) */}
              {(graph.dependencies || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Dependencies ({searchQuery ? `${filteredDependencies.length} of ${(graph.dependencies || []).length}` : (graph.dependencies || []).length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredDependencies.map((dep, i) => {
                      const depResource = allResources.find(r => r.id === dep.id);
                      const depCost = depResource?.cost ?? 0;
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            if (onResourceClick) {
                              // Try to find the full resource in the loaded resources
                              const fullResource = allResources.find(r => r.id === dep.id);
                              if (fullResource) {
                                onResourceClick(fullResource);
                              } else {
                                // Fetch the resource details from API
                                fetch(`/api/resources?id=${encodeURIComponent(dep.id)}`)
                                  .then(r => r.json())
                                  .then(data => {
                                    if (data.data && data.data.length > 0) {
                                      onResourceClick(data.data[0]);
                                    }
                                  })
                                  .catch(err => console.error('Failed to fetch resource:', err));
                              }
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: 12,
                            borderRadius: 10,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border)',
                            cursor: onResourceClick ? 'pointer' : 'default',
                            transition: 'background 0.2s ease, border-color 0.2s ease',
                          }}
                          onMouseEnter={e => {
                            if (onResourceClick) {
                              e.currentTarget.style.background = 'var(--bg-hover)';
                              e.currentTarget.style.borderColor = 'var(--accent-border)';
                            }
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--bg-surface)';
                            e.currentTarget.style.borderColor = 'var(--border)';
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{getRelationshipIcon(dep.relationship || 'unknown')}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{friendlyType(dep.type)}</div>
                          </div>
                          {depCost > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>${depCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          )}
                          <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: getRelationshipColor(dep.relationship || 'unknown') + '20', color: getRelationshipColor(dep.relationship || 'unknown') }}>
                            {dep.relationship}
                          </span>
                          {dep.properties?.role && (
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{dep.properties.role}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dependents (inbound) */}
              {(graph.dependents || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Dependents ({searchQuery ? `${filteredDependents.length} of ${(graph.dependents || []).length}` : (graph.dependents || []).length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filteredDependents.map((dep, i) => {
                      const depResource = allResources.find(r => r.id === dep.id);
                      const depCost = depResource?.cost ?? 0;
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            if (onResourceClick) {
                              // Try to find the full resource in the loaded resources
                              const fullResource = allResources.find(r => r.id === dep.id);
                              if (fullResource) {
                                onResourceClick(fullResource);
                              } else {
                                // Fetch the resource details from API
                                fetch(`/api/resources?id=${encodeURIComponent(dep.id)}`)
                                  .then(r => r.json())
                                  .then(data => {
                                    if (data.data && data.data.length > 0) {
                                      onResourceClick(data.data[0]);
                                    }
                                  })
                                  .catch(err => console.error('Failed to fetch resource:', err));
                              }
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: 12,
                            borderRadius: 10,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border)',
                            cursor: onResourceClick ? 'pointer' : 'default',
                            transition: 'background 0.2s ease, border-color 0.2s ease',
                          }}
                          onMouseEnter={e => {
                            if (onResourceClick) {
                              e.currentTarget.style.background = 'var(--bg-hover)';
                              e.currentTarget.style.borderColor = 'var(--accent-border)';
                            }
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--bg-surface)';
                            e.currentTarget.style.borderColor = 'var(--border)';
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{getRelationshipIcon(dep.relationship || 'unknown')}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{friendlyType(dep.type)}</div>
                          </div>
                          {depCost > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>${depCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          )}
                          <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: getRelationshipColor(dep.relationship || 'unknown') + '20', color: getRelationshipColor(dep.relationship || 'unknown') }}>
                            {dep.relationship}
                          </span>
                          {dep.properties?.role && (
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{dep.properties.role}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(graph.dependencies || []).length === 0 && (graph.dependents || []).length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.5 }}>
                    <circle cx="12" cy="5" r="3" />
                    <circle cx="5" cy="19" r="3" />
                    <circle cx="19" cy="19" r="3" />
                  </svg>
                  <div>No dependencies found for this resource</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default DependencyGraphModal;
