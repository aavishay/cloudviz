import { useState, useEffect, useMemo, useRef, Component, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from 'recharts';

// ─── Error Boundary ───────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, maxWidth: 600, margin: '40px auto', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ color: '#f43f5e', marginBottom: 16 }}>Something went wrong</h1>
          <pre style={{ background: '#1a1a2e', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 12, color: '#e2e8f0' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '12px 24px', background: '#10b981', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AzureResource {
  id: string;
  name: string;
  type: string;
  location: string;
  subscriptionId: string;
  resourceGroup: string;
  cost?: number;
  tags?: Record<string, string>;
  optimization?: string;
  status?: string;
  score?: number;
  isOrphaned?: boolean;
}

interface CostPrediction {
  cost: number;
  previousCost?: number;
  trend?: number;
  resourceId?: string;
  resourceGroup?: string;
  resourceType?: string;
  resourceLocation?: string;
  subscriptionId: string;
}

type SortConfig = { key: string | null; direction: 'asc' | 'desc' };

type MetricSeries = Record<string, number[]>;

interface CostItem {
  resourceGroup: string;
  resourceType: string;
  resourceLocation: string;
  cost: number;
}

interface AggregatedCost {
  cost: number;
  previousCost: number;
  trend: number;
  resourceId: string;
  resourceGroup: string;
  resourceType: string;
  resourceLocation: string;
  subscriptionId: string;
}

interface ResourceChange {
  resourceId: string;
  resourceName: string;
  changeType: string;
  field: string;
  oldValue: string;
  newValue: string;
  timestamp: string;
}

// ─── Resource type labels ─────────────────────────────────────────────────────

const RESOURCE_TYPE_NAMES: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'Virtual Machine',
  'microsoft.network/networkinterfaces': 'Network Interface',
  'microsoft.network/publicipaddresses': 'Public IP',
  'microsoft.network/virtualnetworks': 'Virtual Network',
  'microsoft.network/networksecuritygroups': 'Security Group',
  'microsoft.storage/storageaccounts': 'Storage Account',
  'microsoft.compute/disks': 'Managed Disk',
  'microsoft.operationalinsights/workspaces': 'Log Analytics',
  'microsoft.insights/components': 'App Insights',
  'microsoft.web/sites': 'App Service',
  'microsoft.sql/servers/databases': 'SQL Database',
  'microsoft.containerservice/managedclusters': 'AKS Cluster',
  'microsoft.web/serverfarms': 'App Service Plan',
  'microsoft.containerregistry/registries': 'Container Registry',
  'microsoft.keyvault/vaults': 'Key Vault',
  'microsoft.network/loadbalancers': 'Load Balancer',
  'microsoft.network/applicationgateways': 'App Gateway',
  'microsoft.network/azurefirewalls': 'Azure Firewall',
  'microsoft.network/bastionhosts': 'Bastion Host',
  'microsoft.network/routetables': 'Route Table',
  'microsoft.network/privatednszones': 'Private DNS Zone',
  'microsoft.network/privateendpoints': 'Private Endpoint',
  'microsoft.dbforredis/redis': 'Redis Cache',
  'microsoft.search/searchservices': 'Search Service',
  'microsoft.automation/automationaccounts': 'Automation Account',
  'microsoft.network/dnszones': 'DNS Zone',
  'microsoft.network/networkwatchers': 'Network Watcher',
  'microsoft.compute/availabilitysets': 'Availability Set',
  'microsoft.compute/snapshots': 'Snapshot',
  'microsoft.eventhub/namespaces': 'Event Hub',
  'microsoft.servicebus/namespaces': 'Service Bus',
  'microsoft.network/p2svpngateways': 'P2S VPN Gateway',
  'microsoft.network/privatelinkhubs': 'Private Link Hub',
  'microsoft.insights/queries': 'Query',
  'microsoft.insights/scheduledqueryrules': 'Scheduled Query Rule',
  'microsoft.recoveryservices/vaults': 'Recovery Vault',
  // Short form
  'virtualmachines': 'Virtual Machine',
  'networkinterfaces': 'Network Interface',
  'publicipaddresses': 'Public IP',
  'virtualnetworks': 'Virtual Network',
  'networksecuritygroups': 'Security Group',
  'storageaccounts': 'Storage Account',
  'disks': 'Managed Disk',
  'workspaces': 'Workspace',
  'components': 'App Insights',
  'sites': 'App Service',
  'databases': 'Database',
  'managedclusters': 'AKS Cluster',
  'serverfarms': 'App Service Plan',
  'registries': 'Container Registry',
  'vaults': 'Key Vault',
  'loadbalancers': 'Load Balancer',
  'applicationgateways': 'App Gateway',
  'routetables': 'Route Table',
  'redis': 'Redis Cache',
};

const friendlyType = (type: string) => {
  if (!type) return 'Unknown';
  const low = type.toLowerCase();
  if (RESOURCE_TYPE_NAMES[low]) return RESOURCE_TYPE_NAMES[low];
  const last = type.split('/').pop() || type;
  if (RESOURCE_TYPE_NAMES[last.toLowerCase()]) return RESOURCE_TYPE_NAMES[last.toLowerCase()];
  return last.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim()
    .split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

// ─── Sparkline ────────────────────────────────────────────────────────────────

const Sparkline = ({ data }: { data: number[] }) => {
  if (!data || !Array.isArray(data) || data.length < 2) return null;
  // Filter out NaN/Infinity values
  const validData = data.filter(v => typeof v === 'number' && isFinite(v));
  if (validData.length < 2) return null;
  const max = Math.max(...validData), min = Math.min(...validData), range = max - min || 1;
  const W = 72, H = 22;
  const pts = validData.map((v, i) => `${(i / (validData.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ');
  return (
    <svg width={W} height={H} style={{ overflow: 'visible', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
};

// ─── Score ring ───────────────────────────────────────────────────────────────

const ScoreRing = ({ score }: { score: number }) => {
  const r = 12, circ = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--accent)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  return (
    <svg width={30} height={30} className="score-ring" style={{ flexShrink: 0 }}>
      <circle cx={15} cy={15} r={r} fill="none" stroke="var(--border-strong)" strokeWidth="2.5" />
      <circle cx={15} cy={15} r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ}
        strokeLinecap="round" transform="rotate(-90 15 15)" />
      <text x={15} y={15} dominantBaseline="central" textAnchor="middle"
        style={{ fontSize: 7, fontWeight: 900, fill: color }}>{score}</text>
    </svg>
  );
};

// ─── StatusDot ────────────────────────────────────────────────────────────────

const StatusDot = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    Succeeded: 'var(--accent)', Running: 'var(--blue)', Failed: 'var(--danger)',
    Stopped: 'var(--text-2)', Deallocated: 'var(--text-3)', Updating: 'var(--blue)',
  };
  const color = colors[status] || 'var(--text-3)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>{status}</span>
    </span>
  );
};

// ─── Empty State ──────────────────────────────────────────────────────────────

const EmptyState = ({ icon, message }: { icon?: React.ReactNode; message: string }) => (
  <div className="empty-state">
    {icon && <div style={{ marginBottom: 8, opacity: 0.4 }}>{icon}</div>}
    <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.02 }}>{message}</span>
  </div>
);

// ─── Portal ───────────────────────────────────────────────────────────────────

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return mounted ? createPortal(children, document.body) : null;
}

// ─── FilterDropdown (multi) ───────────────────────────────────────────────────

function FilterDropdown({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const hasValue = selected.length > 0;

  const dropdownStyle = useMemo(() => {
    const rect = ref.current?.getBoundingClientRect();
    return {
      top: (rect?.bottom ?? 0) + 4,
      left: rect?.left ?? 0,
      width: Math.max(rect?.width ?? 0, 220),
      maxHeight: 300,
      zIndex: 900,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, open]);

  return (
    <div className="sidebar-section" ref={ref}>
      <span className="sidebar-heading">{label}</span>
      <button className={`filter-trigger ${hasValue ? 'has-value' : ''}`} onClick={() => setOpen(v => !v)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: hasValue ? 700 : 400, color: hasValue ? 'var(--accent)' : 'var(--text-2)' }}>
          {hasValue ? `${selected.length} selected` : `All ${label}s`}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <Portal>
          <div ref={dropRef} className="filter-panel" style={dropdownStyle}>
            <div className="filter-search">
              <input autoFocus placeholder={`Search ${label.toLowerCase()}s...`} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {hasValue && (
              <button onClick={() => selected.forEach(s => onToggle(s))}
                style={{ margin: '4px 8px 0', padding: '4px 6px', fontSize: 11, fontWeight: 700, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                Clear all
              </button>
            )}
            <div className="filter-options">
              {filtered.map(o => (
                <label key={o} className="filter-option">
                  <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o}</span>
                </label>
              ))}
              {filtered.length === 0 && <div style={{ padding: '12px 8px', color: 'var(--text-3)', fontSize: 12 }}>No results</div>}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// ─── SingleFilterDropdown ─────────────────────────────────────────────────────

function SingleFilterDropdown({ label, options, selected, onSelect, getLabel }: {
  label: string; options: string[]; selected: string; onSelect: (v: string) => void; getLabel?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const display = (v: string) => getLabel ? getLabel(v) : v;
  const filtered = options.filter(o => display(o).toLowerCase().includes(search.toLowerCase()));
  const hasValue = !!selected;

  const dropdownStyle = useMemo(() => {
    const rect = ref.current?.getBoundingClientRect();
    return {
      position: 'fixed' as const,
      top: (rect?.bottom ?? 0) + 4,
      left: rect?.left ?? 0,
      width: Math.max(rect?.width ?? 0, 220),
      maxHeight: 300,
      zIndex: 900,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.current, open]);

  return (
    <div className="sidebar-section" ref={ref}>
      <span className="sidebar-heading">{label}</span>
      <button className={`filter-trigger ${hasValue ? 'has-value' : ''}`} onClick={() => setOpen(v => !v)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: hasValue ? 700 : 400, color: hasValue ? 'var(--accent)' : 'var(--text-2)' }}>
          {hasValue ? display(selected) : `All Types`}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <Portal>
          <div ref={dropRef} className="filter-panel" style={dropdownStyle}>
            <div className="filter-search">
              <input autoFocus placeholder="Search types..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="filter-options">
              <button className="filter-option" style={{ border: 'none', background: 'none', width: '100%', textAlign: 'left', fontWeight: !selected ? 700 : 400, color: !selected ? 'var(--accent)' : 'var(--text-1)' }}
                onClick={() => { onSelect(''); setOpen(false); setSearch(''); }}>
                All Types
              </button>
              {filtered.map(o => (
                <button key={o} className="filter-option" style={{ border: 'none', background: selected === o ? 'var(--accent-dim)' : 'none', width: '100%', textAlign: 'left', fontWeight: selected === o ? 700 : 400, color: selected === o ? 'var(--accent)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => { onSelect(o); setOpen(false); setSearch(''); }}>
                  {display(o)}
                </button>
              ))}
              {filtered.length === 0 && <div style={{ padding: '12px 8px', color: 'var(--text-3)', fontSize: 12 }}>No results</div>}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

// ─── ChevronIcon ──────────────────────────────────────────────────────────────

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-3)', flexShrink: 0 }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// ─── ResourceTable ────────────────────────────────────────────────────────────

interface ResourceTableProps {
  resources: AzureResource[];
  sortConfig: SortConfig;
  onSort: (key: string) => void;
  onLocationClick: (loc: string) => void;
  onRgClick: (rg: string) => void;
  onSubClick: (sub: string) => void;
  onTypeClick: (type: string) => void;
  onResourceClick: (r: AzureResource) => void;
}

const COLUMNS = [
  { key: 'name',           label: 'Name',           defaultW: 200 },
  { key: 'type',           label: 'Type',          defaultW: 130 },
  { key: 'location',       label: 'Location',       defaultW: 100 },
  { key: 'resourceGroup',  label: 'Resource Group', defaultW: 140 },
  { key: 'subscriptionId', label: 'Subscription',  defaultW: 150 },
  { key: 'optimization',   label: 'Score',         defaultW: 90 },
  { key: 'cost',           label: 'Cost',          defaultW: 100 },
];

function ResourceTable({ resources, sortConfig, onSort, onLocationClick, onRgClick, onSubClick, onTypeClick, onResourceClick }: ResourceTableProps) {
  const [widths, setWidths] = useState<Record<string, number>>(
    Object.fromEntries(COLUMNS.map(c => [c.key, c.defaultW]))
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    if (wrapRef.current) {
      const availableW = wrapRef.current.clientWidth;
      const defaultTotal = COLUMNS.reduce((sum, c) => sum + c.defaultW, 0);
      if (availableW > defaultTotal) {
        setWidths(prev => ({
          ...prev,
          name: prev.name + (availableW - defaultTotal)
        }));
      }
    }
  }, []);

  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key, startX: e.pageX, startW: widths[key] };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setWidths(prev => ({ ...prev, [resizing.current!.key]: Math.max(60, resizing.current!.startW + ev.pageX - resizing.current!.startX) }));
    };
    const onUp = () => { resizing.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const totalWidth = COLUMNS.reduce((sum, c) => sum + widths[c.key], 0);

  return (
    <div className="resource-table-wrap" ref={wrapRef}>
      <table className="resource-table" style={{ width: totalWidth, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {COLUMNS.map(c => (
              <th key={c.key} className={sortConfig.key === c.key ? 'sorted' : ''} onClick={() => onSort(c.key)} style={{ position: 'relative', width: widths[c.key], textAlign: c.key === 'cost' ? 'right' : 'left' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 12, justifyContent: c.key === 'cost' ? 'flex-end' : 'flex-start' }}>
                  {c.label}
                  {sortConfig.key === c.key && (
                    <span style={{ color: 'var(--accent)', fontSize: 10 }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </span>
                <span className="col-resize-handle" onMouseDown={e => startResize(c.key, e)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((r, i) => (
            <tr key={r.id || i}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <button
                    onClick={() => onResourceClick(r)}
                    title={r.name}
                    className="resource-name-link cell-truncate"
                    style={{ fontWeight: 600 }}
                  >
                    {r.name}
                  </button>
                </div>
              </td>
              <td>
                <button className="badge badge-type cell-truncate" onClick={() => onTypeClick(r.type)} title={friendlyType(r.type)}>
                  {friendlyType(r.type)}
                </button>
              </td>
              <td>
                <button className="badge badge-loc cell-truncate" onClick={() => onLocationClick(r.location)} title={r.location}>
                  {r.location}
                </button>
              </td>
              <td>
                <button className="badge badge-rg cell-truncate" onClick={() => onRgClick(r.resourceGroup)} title={r.resourceGroup}>
                  {r.resourceGroup}
                </button>
              </td>
              <td>
                <button 
                  onClick={() => onSubClick(r.subscriptionId)} 
                  title={r.subscriptionId} 
                  className="cell-truncate"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-2)', width: '100%', textAlign: 'left' }}
                >
                  {r.subscriptionId}
                </button>
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ScoreRing score={r.score ?? 100} />
                  {r.optimization && (
                    <span className="badge badge-opt" style={{ fontSize: 9, padding: '2px 6px' }}>
                      {r.optimization}
                    </span>
                  )}
                </div>
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)', textAlign: 'right' }}>
                ${(r.cost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
          {resources.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 40 }}>
              <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>} message="No resources matched your criteria" />
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── AIInsightsModal ──────────────────────────────────────────────────────────

function AIInsightsModal({ resource, onClose, insight, loading }: {
  resource: AzureResource; onClose: () => void; insight: { metrics: MetricSeries; recommendation: string } | null; loading: boolean;
}) {
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
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="info-grid">
            <div className="info-cell">
              <div className="info-cell-label">Resource Group</div>
              <div className="info-cell-value" style={{ fontSize: 12, wordBreak: 'break-all' }}>{resource.resourceGroup}</div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">Location</div>
              <div className="info-cell-value">{resource.location}</div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">30-Day Cost</div>
              <div className="info-cell-value" style={{ color: 'var(--accent)', fontSize: 20 }}>${(resource.cost ?? 0).toFixed(2)}</div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">Efficiency Score</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <ScoreRing score={resource.score ?? 100} />
                <span style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 14 }}>{resource.score ?? 100}/100</span>
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2"><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
                Historical Metrics (7 Days)
              </span>
            </div>
            {insight?.metrics ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(insight.metrics).map(([name, vals]) => (
                  <div key={name} className="metric-card">
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 2 }}>{name}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>
                        {(vals[vals.length - 1] ?? 0).toFixed(1)}%
                      </div>
                    </div>
                    <Sparkline data={vals} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: 'var(--text-2)', fontSize: 13 }}>
                <div className="spinner" />
                Fetching telemetry...
              </div>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
                AI Recommendations
              </span>
            </div>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-2)', fontSize: 13 }}>
                <div className="spinner" />
                Consulting Ollama LLM...
              </div>
            ) : (
              <div className="reco-box">
                {insight?.recommendation ?? 'No recommendation available for this resource.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose, uniqueRegions, uniqueSubs, uniqueRGs, uniqueTypes, regionFilter, subFilter, rgFilter, typeFilter, showOrphanedOnly, setRegionFilter, setSubFilter, setRgFilter, setTypeFilter, setShowOrphanedOnly, setCurrentPage, collapsed, onToggleCollapse }: {
  open: boolean; onClose: () => void;
  uniqueRegions: string[]; uniqueSubs: string[]; uniqueRGs: string[]; uniqueTypes: string[];
  regionFilter: string[]; subFilter: string[]; rgFilter: string[]; typeFilter: string; showOrphanedOnly: boolean;
  setRegionFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setSubFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setRgFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setTypeFilter: React.Dispatch<React.SetStateAction<string>>;
  setShowOrphanedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (val: string) => {
    setter(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
    setCurrentPage(1);
  };

  const hasFilters = regionFilter.length || subFilter.length || rgFilter.length || typeFilter || showOrphanedOnly;

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Toggle Button (Desktop) */}
          <button
            onClick={onToggleCollapse}
            className="sidebar-toggle-btn desktop-only"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{ 
              display: 'flex', alignItems: 'center', justifyContent: 'center', 
              width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)', 
              background: 'var(--bg-surface)', color: 'var(--text-2)', cursor: 'pointer',
              alignSelf: collapsed ? 'center' : 'flex-end', marginBottom: 12, flexShrink: 0
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d={collapsed ? "M13 5l7 7-7 7M5 5l7 7-7 7" : "M11 19l-7-7 7-7M19 19l-7-7 7-7"} />
            </svg>
          </button>

          {!collapsed && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.5"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Filters</span>
                </div>
                {hasFilters ? (
                  <button onClick={() => { setRegionFilter([]); setSubFilter([]); setRgFilter([]); setTypeFilter(''); setShowOrphanedOnly(false); setCurrentPage(1); }}
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', transition: 'opacity 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    Clear all
                  </button>
                ) : null}
              </div>

              <FilterDropdown label="Region" options={uniqueRegions} selected={regionFilter} onToggle={toggle(setRegionFilter)} />
              <FilterDropdown label="Subscription" options={uniqueSubs} selected={subFilter} onToggle={toggle(setSubFilter)} />
              <FilterDropdown label="Resource Group" options={uniqueRGs} selected={rgFilter} onToggle={toggle(setRgFilter)} />
              <SingleFilterDropdown label="Resource Type" options={uniqueTypes} selected={typeFilter}
                onSelect={v => { setTypeFilter(v); setCurrentPage(1); }} getLabel={friendlyType} />

              <div className="sidebar-section" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Quick Filters</span>
                </div>
                <button
                  onClick={() => { setShowOrphanedOnly(v => !v); setCurrentPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                    border: showOrphanedOnly ? '1px solid var(--danger)' : '1px solid var(--border)',
                    background: showOrphanedOnly ? 'var(--danger-dim)' : 'var(--bg-surface)',
                    color: showOrphanedOnly ? 'var(--danger)' : 'var(--text-2)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                  Orphaned resources only
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [resources, setResources] = useState<AzureResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [costs, setCosts] = useState<CostPrediction[]>([]);
  const [costsLoading, setCostsLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState<string[]>([]);
  const [subFilter, setSubFilter] = useState<string[]>([]);
  const [rgFilter, setRgFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [showOrphanedOnly, setShowOrphanedOnly] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('cloudviz-theme');
    return saved ? saved === 'dark' : true;
  });

  const [selectedResource, setSelectedResource] = useState<AzureResource | null>(null);
  const [aiInsight, setAiInsight] = useState<{ metrics: MetricSeries; recommendation: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  const [activeTab, setActiveTab] = useState<'dashboard' | 'resources' | 'costs' | 'history'>('dashboard');
  const [selectedCost, setSelectedCost] = useState<CostPrediction | null>(null);
  const [costSearchQuery, setCostSearchQuery] = useState('');
  const [dailyCosts, setDailyCosts] = useState<{ date: string; cost: number }[]>([]);
  const [budgetLimit, setBudgetLimit] = useState<number>(() => {
    const saved = localStorage.getItem('cloudviz-budget');
    return saved ? parseFloat(saved) : 0;
  });
  const [history, setHistory] = useState<ResourceChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [allPossibleFilters, setAllPossibleFilters] = useState<{ subs: string[]; locations: string[]; rgs: string[]; types: string[] }>({
    subs: [], locations: [], rgs: [], types: [],
  });
  const [totalResources, setTotalResources] = useState(0);
  const [filteredTotalCost, setFilteredTotalCost] = useState(0);

  const debouncedSearch = useDebounce(searchQuery, 500);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
    localStorage.setItem('cloudviz-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Fetch filter options
  useEffect(() => {
    fetch('http://localhost:8080/api/filters')
      .then(r => r.json())
      .then(data => setAllPossibleFilters(data))
      .catch(console.error);
  }, []);

  // Fetch resources
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    regionFilter.forEach(f => params.append('location', f));
    subFilter.forEach(f => params.append('subscriptionId', f));
    rgFilter.forEach(f => params.append('resourceGroup', f));
    if (typeFilter) params.append('type', typeFilter);
    if (debouncedSearch) params.append('search', debouncedSearch);
    if (showOrphanedOnly) params.append('orphaned', 'true');
    params.append('skip', String((currentPage - 1) * itemsPerPage));
    params.append('limit', String(itemsPerPage));
    if (sortConfig.key) { params.append('sortBy', sortConfig.key); params.append('sortOrder', sortConfig.direction); }

    fetch(`http://localhost:8080/api/resources?${params}`)
      .then(r => r.json())
      .then(data => { setResources(data.data || []); setTotalResources(data.total || 0); setFilteredTotalCost(data.totalCost || 0); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [regionFilter, subFilter, rgFilter, typeFilter, debouncedSearch, showOrphanedOnly, currentPage, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
    setCurrentPage(1);
  };

  const uniqueRegions = useMemo(() => [...(allPossibleFilters.locations || [])].sort(), [allPossibleFilters.locations]);
  const uniqueSubs = useMemo(() => [...(allPossibleFilters.subs || [])].sort(), [allPossibleFilters.subs]);
  const uniqueRGs = useMemo(() => [...(allPossibleFilters.rgs || [])].sort(), [allPossibleFilters.rgs]);
  const uniqueTypes = useMemo(() => [...(allPossibleFilters.types || [])].sort((a, b) => friendlyType(a).localeCompare(friendlyType(b))), [allPossibleFilters.types]);

  // Fetch daily costs for dashboard trends
  useEffect(() => {
    if (uniqueSubs.length === 0) return;
    const subId = uniqueSubs[0];
    fetch(`http://localhost:8080/api/costs/daily?subscriptionId=${subId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setDailyCosts(data);
        } else {
          console.error('dailyCosts API returned non-array:', data);
          setDailyCosts([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch daily costs', err);
        setDailyCosts([]);
      });
  }, [uniqueSubs]);

  const fetchAIInsights = async (resource: AzureResource) => {
    setAiLoading(true);
    setAiInsight(null);
    try {
      const res = await fetch(`http://localhost:8080/api/ai-insights/${encodeURIComponent(resource.id)}`);
      setAiInsight(await res.json());
    } catch (err) {
      console.error('AI insight failed', err);
    } finally {
      setAiLoading(false);
    }
  };

  const fetchCosts = (forceAll = false) => {
    if (uniqueSubs.length === 0 || costsLoading) return;
    const existing = forceAll ? new Set<string>() : new Set(costs.map(c => c.subscriptionId));
    const toFetch = uniqueSubs.filter(s => !existing.has(s));
    if (toFetch.length === 0) return;

    setCostsLoading(true);
    const params = new URLSearchParams();
    toFetch.forEach(s => params.append('subscriptionId', s));

    const es = new EventSource(`http://localhost:8080/api/costs/stream?${params.toString()}`);

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          const subId = msg.subId;
          const currentItems = msg.data.current || [];
          const previousItems = msg.data.previous || [];
          const prevMap = new Map<string, number>();
          previousItems.forEach((item: CostItem) => prevMap.set(`${item.resourceGroup}-${item.resourceType}-${item.resourceLocation}`, Number(item.cost)));

          const newItems: AggregatedCost[] = currentItems.map((item: CostItem) => {
            const cost = Number(item.cost) || 0;
            const prev = prevMap.get(`${item.resourceGroup}-${item.resourceType}-${item.resourceLocation}`) ?? 0;
            return {
              cost,
              previousCost: prev,
              trend: prev > 0 ? ((cost - prev) / prev) * 100 : (cost > 0 ? 100 : 0),
              resourceId: '', // Aggregated
              resourceGroup: item.resourceGroup || '',
              resourceType: item.resourceType || '',
              resourceLocation: item.resourceLocation || '',
              subscriptionId: subId
            };
          }).filter((item: AggregatedCost) => isFinite(item.cost) && isFinite(item.previousCost));

          setResources(prev => {
            return prev.map(r => {
              if (r.subscriptionId !== subId) return r;
              const matchingCost = newItems.find((c: AggregatedCost) => 
                c.resourceGroup.toLowerCase() === r.resourceGroup?.toLowerCase() &&
                // Flexible match for types and exact match for normalized location
                (c.resourceType.includes(r.type?.toLowerCase() || '') || (r.type?.toLowerCase() || '').includes(c.resourceType)) &&
                c.resourceLocation.toLowerCase() === (r.location?.toLowerCase() || '').replace(/\s/g, '')
              );
              return { ...r, cost: matchingCost ? matchingCost.cost : r.cost };
            });
          });

          setCosts(prev => {
            const filtered = prev.filter(c => c.subscriptionId !== subId);
            return [...filtered, ...newItems];
          });
        } else if (msg.type === 'done') {
          es.close();
          setCostsLoading(false);
        }
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };

    es.onerror = () => {
      es.close();
      setCostsLoading(false);
    };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (uniqueSubs.length > 0) fetchCosts(); }, [uniqueSubs]);

  // Fetch resource change history
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('http://localhost:8080/api/history?limit=100');
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch history', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
  }, [activeTab]);

  const detailResources = useMemo(() => {
    if (!selectedCost) return [];
    if (selectedCost.resourceId) return resources.filter(r => r.id.toLowerCase() === selectedCost.resourceId?.toLowerCase());
    return resources.filter(r =>
      r.subscriptionId === selectedCost.subscriptionId &&
      r.resourceGroup?.toLowerCase() === selectedCost.resourceGroup?.toLowerCase() &&
      r.type?.toLowerCase() === selectedCost.resourceType?.toLowerCase()
    );
  }, [resources, selectedCost]);

  const totalPages = Math.max(1, Math.ceil(totalResources / itemsPerPage));

  const exportCSV = () => {
    const params = new URLSearchParams();
    regionFilter.forEach(f => params.append('location', f));
    subFilter.forEach(f => params.append('subscriptionId', f));
    rgFilter.forEach(f => params.append('resourceGroup', f));
    if (typeFilter) params.append('type', typeFilter);
    if (debouncedSearch) params.append('search', debouncedSearch);
    window.open(`http://localhost:8080/api/export?${params}`, '_blank');
  };

  const debouncedCostSearch = useDebounce(costSearchQuery, 300);

  const filteredCosts = useMemo(() => {
    if (!debouncedCostSearch) return costs;
    const q = debouncedCostSearch.toLowerCase();
    return costs.filter(c =>
      (c.resourceGroup || '').toLowerCase().includes(q) ||
      (c.resourceType || '').toLowerCase().includes(q) ||
      (c.resourceLocation || '').toLowerCase().includes(q)
    );
  }, [costs, debouncedCostSearch]);

  const totalCostsSum = costs.reduce((s, c) => s + c.cost, 0);

  // Dashboard computed values
  const costsByType = useMemo(() => {
    const map = new Map<string, number>();
    costs.forEach(c => {
      const type = friendlyType(c.resourceType || 'Other');
      map.set(type, (map.get(type) || 0) + c.cost);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [costs]);

  const costsByRegion = useMemo(() => {
    const map = new Map<string, number>();
    costs.forEach(c => {
      map.set(c.resourceLocation || 'Unknown', (map.get(c.resourceLocation || 'Unknown') || 0) + c.cost);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [costs]);

  const costsBySubscription = useMemo(() => {
    const map = new Map<string, number>();
    costs.forEach(c => {
      const shortId = c.subscriptionId.split('-')[0];
      map.set(shortId, (map.get(shortId) || 0) + c.cost);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [costs]);

  const topSpenders = useMemo(() => {
    return [...costs].sort((a, b) => b.cost - a.cost).slice(0, 5);
  }, [costs]);

  const orphanedCount = useMemo(() => {
    return resources.filter(r => r.isOrphaned).length;
  }, [resources]);

  const lowScoreCount = useMemo(() => {
    return resources.filter(r => (r.score ?? 100) < 50).length;
  }, [resources]);

  const optimizationOpportunities = useMemo(() => {
    const opportunities: { resource: AzureResource; reason: string; potentialSavings: number }[] = [];
    resources.forEach(r => {
      if (r.isOrphaned) {
        opportunities.push({ resource: r, reason: 'Orphaned resource', potentialSavings: r.cost || 0 });
      } else if ((r.score ?? 100) < 50) {
        opportunities.push({ resource: r, reason: r.optimization || 'Low efficiency score', potentialSavings: (r.cost || 0) * 0.3 });
      } else if (r.type.toLowerCase().includes('virtualmachine') && r.name.toLowerCase().match(/(dev|test|sandbox|tmp)/i)) {
        opportunities.push({ resource: r, reason: 'Dev/Test VM - consider shutting down', potentialSavings: (r.cost || 0) * 0.5 });
      }
    });
    return opportunities.sort((a, b) => b.potentialSavings - a.potentialSavings).slice(0, 10);
  }, [resources]);

  const totalPotentialSavings = useMemo(() => {
    return optimizationOpportunities.reduce((s, o) => s + o.potentialSavings, 0);
  }, [optimizationOpportunities]);

  // Cost allocation by environment tag (if available)
  const costsByEnvironment = useMemo(() => {
    const envMap = new Map<string, number>();
    resources.forEach(r => {
      const env = r.tags?.Environment || r.tags?.environment || r.tags?.env || 'Untagged';
      const normalizedEnv = env.charAt(0).toUpperCase() + env.slice(1).toLowerCase();
      envMap.set(normalizedEnv, (envMap.get(normalizedEnv) || 0) + (r.cost || 0));
    });
    return Array.from(envMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [resources]);

  // Resource age distribution
  const resourceAgeDistribution = useMemo(() => {
    const ageGroups: { label: string; count: number; cost: number; color: string }[] = [
      { label: 'Small (<$10)', count: 0, cost: 0, color: '#10b981' },
      { label: 'Medium ($10-100)', count: 0, cost: 0, color: '#3b82f6' },
      { label: 'Large ($100-500)', count: 0, cost: 0, color: '#f59e0b' },
      { label: 'XLarge ($500+)', count: 0, cost: 0, color: '#ef4444' },
    ];
    resources.forEach(r => {
      const cost = r.cost || 0;
      if (cost < 10) { ageGroups[0].count++; ageGroups[0].cost += cost; }
      else if (cost < 100) { ageGroups[1].count++; ageGroups[1].cost += cost; }
      else if (cost < 500) { ageGroups[2].count++; ageGroups[2].cost += cost; }
      else { ageGroups[3].count++; ageGroups[3].cost += cost; }
    });
    return ageGroups;
  }, [resources]);

  // Resource topology for map
  const resourceTopology = useMemo(() => {
    const byRG = new Map<string, { count: number; types: Map<string, number>; cost: number }>();
    resources.forEach(r => {
      const rg = r.resourceGroup || 'Unknown';
      if (!byRG.has(rg)) {
        byRG.set(rg, { count: 0, types: new Map(), cost: 0 });
      }
      const entry = byRG.get(rg)!;
      entry.count++;
      entry.cost += r.cost || 0;
      const type = friendlyType(r.type);
      entry.types.set(type, (entry.types.get(type) || 0) + 1);
    });
    return Array.from(byRG.entries())
      .map(([name, data]) => ({ name, ...data, types: Array.from(data.types.entries()).map(([t, c]) => ({ type: t, count: c })) }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 6);
  }, [resources]);

  // Forecast next month's cost based on daily average
  const forecastedMonthlyCost = useMemo(() => {
    if (!Array.isArray(dailyCosts) || dailyCosts.length < 7) return null;
    const recentDays = dailyCosts.slice(-7);
    const avgDailyCost = recentDays.reduce((s, d) => s + d.cost, 0) / recentDays.length;
    return avgDailyCost * 30;
  }, [dailyCosts]);

  // Budget status
  const budgetStatus = useMemo(() => {
    if (budgetLimit <= 0) return null;
    const percentage = (totalCostsSum / budgetLimit) * 100;
    if (percentage >= 100) return { status: 'over', message: 'Budget exceeded', color: 'var(--danger)' };
    if (percentage >= 90) return { status: 'critical', message: '90%+ of budget used', color: 'var(--danger)' };
    if (percentage >= 75) return { status: 'warning', message: '75%+ of budget used', color: 'var(--warning)' };
    return { status: 'ok', message: `${percentage.toFixed(0)}% of budget`, color: 'var(--accent)' };
  }, [budgetLimit, totalCostsSum]);

  // Month-over-month cost comparison
  const costComparison = useMemo(() => {
    const currentTotal = costs.reduce((s, c) => s + c.cost, 0);
    const previousTotal = costs.reduce((s, c) => s + (c.previousCost || 0), 0);
    if (previousTotal === 0) return null;
    const change = currentTotal - previousTotal;
    const percentChange = ((change / previousTotal) * 100);
    return {
      current: currentTotal,
      previous: previousTotal,
      change,
      percentChange,
      isIncrease: change > 0
    };
  }, [costs]);

  // Biggest cost changes (by absolute change)
  const biggestChanges = useMemo(() => {
    return costs
      .filter(c => c.previousCost && c.previousCost > 0 && c.cost !== c.previousCost)
      .map(c => ({
        ...c,
        change: c.cost - (c.previousCost || 0),
        percentChange: ((c.cost - (c.previousCost || 0)) / (c.previousCost || 1)) * 100
      }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);
  }, [costs]);

  // Reserved Instance recommendations (for consistent VMs)
  const riRecommendations = useMemo(() => {
    const vmCosts = costs.filter(c =>
      (c.resourceType || '').toLowerCase().includes('virtualmachines') ||
      (c.resourceType || '').toLowerCase().includes('compute/virtualmachines')
    );
    // Group by resource group (as proxy for VM)
    const vmGroupMap = new Map<string, { cost: number; location: string; count: number }>();
    vmCosts.forEach(c => {
      const key = `${c.resourceGroup}|${c.resourceLocation}`;
      const existing = vmGroupMap.get(key) || { cost: 0, location: c.resourceLocation || '', count: 0 };
      vmGroupMap.set(key, { cost: existing.cost + c.cost, location: existing.location, count: existing.count + 1 });
    });
    // Recommend RI for high, consistent spend (potential 30-60% savings)
    return Array.from(vmGroupMap.entries())
      .map(([key, data]) => {
        const [rg, loc] = key.split('|');
        const monthlyCost = data.cost;
        const riSavings = monthlyCost * 0.4; // Conservative 40% savings estimate
        return {
          resourceGroup: rg,
          location: loc,
          monthlyCost,
          potentialSavings: riSavings,
          yearlySavings: riSavings * 12,
          region: data.location
        };
      })
      .filter(r => r.monthlyCost > 500) // Only recommend for significant spend
      .sort((a, b) => b.potentialSavings - a.potentialSavings)
      .slice(0, 5);
  }, [costs]);

  // Cost anomalies - significant cost spikes
  const costAnomalies = useMemo(() => {
    const anomalies: { resourceGroup: string; resourceType: string; location: string; currentCost: number; previousCost: number; spike: number; severity: 'high' | 'medium' | 'low' }[] = [];
    costs.forEach(c => {
      if (c.previousCost && c.previousCost > 10 && c.cost > c.previousCost * 1.5) {
        const spike = ((c.cost - c.previousCost) / c.previousCost) * 100;
        anomalies.push({
          resourceGroup: c.resourceGroup || 'Unknown',
          resourceType: c.resourceType || 'Unknown',
          location: c.resourceLocation || 'Unknown',
          currentCost: c.cost,
          previousCost: c.previousCost,
          spike,
          severity: spike > 200 ? 'high' : spike > 100 ? 'medium' : 'low'
        });
      }
    });
    return anomalies.sort((a, b) => b.spike - a.spike).slice(0, 5);
  }, [costs]);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  // Save budget to localStorage
  const saveBudget = (value: number) => {
    setBudgetLimit(value);
    localStorage.setItem('cloudviz-budget', value.toString());
  };

  const exportCostsCSV = () => {
    const data = filteredCosts.map(c => ({
      subscriptionId: c.subscriptionId,
      resourceGroup: c.resourceGroup || '',
      resourceType: c.resourceType || '',
      resourceLocation: c.resourceLocation || '',
      cost: c.cost.toFixed(2),
      previousCost: c.previousCost?.toFixed(2) || '0',
      trend: c.trend?.toFixed(1) || '0',
    }));

    const headers = ['Subscription ID', 'Resource Group', 'Resource Type', 'Location', 'Cost (30d)', 'Previous Cost', 'Trend %'];
    const csvContent = [
      headers.join(','),
      ...data.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloudviz-costs.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* ── Header ── */}
      <header className="app-header">
        {/* Hamburger (mobile) */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          style={{ display: 'none', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-2)', cursor: 'pointer', flexShrink: 0 }}
          className="mobile-menu-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0, 122, 204, 0.25)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 9.2a7 7 0 0 1-9 8.8Z" />
              <path d="M7 20s-2-3-2-8" />
              <path d="M11 20s2-4 2-9h4" />
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--text-1)' }}>CloudViz</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-3)', letterSpacing: '0.02em', marginTop: -2 }}>Azure Dashboard</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-strip" style={{ marginLeft: 16 }}>
          <button className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
            Dashboard
          </button>
          <button className={`tab ${activeTab === 'resources' ? 'active' : ''}`} onClick={() => setActiveTab('resources')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
            Resources
          </button>
          <button className={`tab ${activeTab === 'costs' ? 'active' : ''}`} onClick={() => setActiveTab('costs')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            Cost Forecast
          </button>
          <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            History
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Sync indicator when loading costs */}
        {costsLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', marginRight: 8 }}>
            <div className="sync-spinner" style={{ width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>Syncing...</span>
          </div>
        )}

        {/* Dark mode */}
        <button
          onClick={() => setIsDarkMode(v => !v)}
          style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          }
        </button>
        <button
          onClick={() => setShowSettings(true)}
          style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 6, transition: 'all 0.15s ease' }}
          title="Budget settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </button>
      </header>

      <style>{`
        @media (max-width: 1023px) { .mobile-menu-btn { display: flex !important; } }
      `}</style>

      <div className="app-body">
        {/* ── Sidebar ── */}
        <Sidebar
          open={sidebarOpen} onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          uniqueRegions={uniqueRegions} uniqueSubs={uniqueSubs} uniqueRGs={uniqueRGs} uniqueTypes={uniqueTypes}
          regionFilter={regionFilter} subFilter={subFilter} rgFilter={rgFilter} typeFilter={typeFilter} showOrphanedOnly={showOrphanedOnly}
          setRegionFilter={setRegionFilter} setSubFilter={setSubFilter} setRgFilter={setRgFilter}
          setTypeFilter={setTypeFilter} setShowOrphanedOnly={setShowOrphanedOnly} setCurrentPage={setCurrentPage}
        />

        {/* ── Main ── */}
        <main className="main-content">
          {activeTab === 'dashboard' ? (
            /* ── Dashboard Tab ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Dashboard Header Actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={exportCSV} title="Export resources as CSV">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                    Export CSV
                  </button>
                  <button className="btn" onClick={exportCostsCSV} title="Export costs as CSV">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                    Export Costs
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {budgetLimit > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Budget: <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>${budgetLimit.toLocaleString()}</span></span>
                      {budgetStatus && budgetLimit > 0 && (
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: budgetStatus.color === 'var(--accent)' ? 'var(--accent-dim)' : budgetStatus.color === 'var(--warning)' ? 'var(--warning-dim)' : 'var(--danger-dim)', color: budgetStatus.color, fontSize: 10, fontWeight: 600 }}>
                          {((totalCostsSum / budgetLimit) * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}
                  <button className="btn" onClick={() => setShowSettings(true)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                    Settings
                  </button>
                </div>
              </div>

              {/* Quick Insights Bar */}
              {(lowScoreCount > 0 || orphanedCount > 0 || costAnomalies.length > 0) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'linear-gradient(135deg, rgba(244 63 94 / 0.08) 0%, rgba(245 158 11 / 0.05) 100%)', borderRadius: 12, border: '1px solid rgba(244 63 94 / 0.15)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--danger-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Action Required:</span>
                    {lowScoreCount > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--warning-dim)', borderRadius: 6, fontSize: 12, fontWeight: 500, color: 'var(--warning)', cursor: 'pointer', transition: 'all 0.2s ease' }} onClick={() => { setActiveTab('resources'); }} onMouseEnter={e => { e.currentTarget.style.transform='scale(1.02)'; }} onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
                        {lowScoreCount} low-score resources
                      </span>
                    )}
                    {orphanedCount > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--danger-dim)', borderRadius: 6, fontSize: 12, fontWeight: 500, color: 'var(--danger)', cursor: 'pointer', transition: 'all 0.2s ease' }} onClick={() => { setActiveTab('resources'); setShowOrphanedOnly(true); }} onMouseEnter={e => { e.currentTarget.style.transform='scale(1.02)'; }} onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                        {orphanedCount} orphaned
                      </span>
                    )}
                    {costAnomalies.length > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(245 158 11 / 0.15)', borderRadius: 6, fontSize: 12, fontWeight: 500, color: 'var(--warning)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        {costAnomalies.length} cost spike{costAnomalies.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => setActiveTab('costs')}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, var(--accent-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(16 185 129 / 0.2)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Total Cost</span>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: budgetStatus?.status === 'over' ? 'var(--danger)' : budgetStatus?.status === 'critical' ? 'var(--danger)' : budgetStatus?.status === 'warning' ? 'var(--warning)' : 'var(--accent)', letterSpacing: '-0.03em', lineHeight: 1 }}>${totalCostsSum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{costs.length} entries</span>
                    {budgetStatus && <span style={{ padding: '2px 8px', borderRadius: 12, background: budgetStatus.color === 'var(--accent)' ? 'var(--accent-dim)' : budgetStatus.color === 'var(--warning)' ? 'var(--warning-dim)' : 'var(--danger-dim)', color: budgetStatus.color, fontSize: 10, fontWeight: 600 }}>{budgetStatus.message}</span>}
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: budgetStatus?.status === 'over' || budgetStatus?.status === 'critical' ? 'var(--danger)' : budgetStatus?.status === 'warning' ? 'var(--warning)' : 'var(--accent)', opacity: 0.6 }} />
                </div>

                <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => setActiveTab('resources')}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, rgba(59 130 246 / 0.1) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--blue-dim)', border: '1px solid rgba(59 130 246 / 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(59 130 246 / 0.2)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Resources</span>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-1)', letterSpacing: '-0.03em', lineHeight: 1 }}>{totalResources.toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{uniqueSubs.length} subscriptions</div>
                </div>

                <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setShowOrphanedOnly(lowScoreCount > 0); setCurrentPage(1); }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, rgba(245 158 11 / 0.1) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245 158 11 / 0.12)', border: '1px solid rgba(245 158 11 / 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(245 158 11 / 0.2)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Optimization</span>
                      {lowScoreCount > 0 && <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--warning-dim)', color: 'var(--warning)', fontSize: 10, fontWeight: 700 }}>{lowScoreCount}</span>}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: lowScoreCount > 0 ? 'var(--warning)' : 'var(--accent)', letterSpacing: '-0.03em', lineHeight: 1 }}>{lowScoreCount}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>resources with score &lt; 50</div>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: lowScoreCount > 0 ? 'var(--warning)' : 'var(--accent)', opacity: 0.6 }} />
                </div>

                <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setShowOrphanedOnly(true); setCurrentPage(1); }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, var(--danger-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--danger-dim)', border: '1px solid rgba(244 63 94 / 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(244 63 94 / 0.2)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Orphaned</span>
                      {orphanedCount > 0 && <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>{orphanedCount}</span>}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: orphanedCount > 0 ? 'var(--danger)' : 'var(--accent)', letterSpacing: '-0.03em', lineHeight: 1 }}>{orphanedCount}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>unattached resources</div>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: orphanedCount > 0 ? 'var(--danger)' : 'var(--accent)', opacity: 0.6 }} />
                </div>

                <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => setActiveTab('costs')}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, rgba(139 92 246 / 0.1) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139 92 246 / 0.12)', border: '1px solid rgba(139 92 246 / 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139 92 246 / 0.2)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Forecast</span>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: forecastedMonthlyCost && budgetLimit > 0 && forecastedMonthlyCost > budgetLimit ? 'var(--danger)' : 'var(--text-1)', letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {forecastedMonthlyCost ? `$${forecastedMonthlyCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{forecastedMonthlyCost ? 'monthly estimate' : 'loading...'}</span>
                    {budgetLimit > 0 && forecastedMonthlyCost && <span style={{ padding: '2px 8px', borderRadius: 12, background: forecastedMonthlyCost > budgetLimit ? 'var(--danger-dim)' : 'var(--accent-dim)', color: forecastedMonthlyCost > budgetLimit ? 'var(--danger)' : 'var(--accent)', fontSize: 10, fontWeight: 600 }}>vs ${budgetLimit.toLocaleString()}</span>}
                  </div>
                </div>

                <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => { if (lowScoreCount + orphanedCount + costAnomalies.length > 0) { setActiveTab('resources'); if (orphanedCount > 0) setShowOrphanedOnly(true); } }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, var(--accent-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: (lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? 'var(--accent-dim)' : 'var(--danger-dim)', border: (lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? '1px solid var(--accent-border)' : '1px solid rgba(244 63 94 / 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: (lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? '0 2px 8px rgba(16 185 129 / 0.2)' : '0 2px 8px rgba(244 63 94 / 0.2)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={(lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? 'var(--accent)' : 'var(--danger)'} strokeWidth="2.5">{(lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /> : <circle cx="12" cy="12" r="10" />}{(lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 && <path d="M9 11l3 3L22 4" />}{(lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) > 0 && <path d="M12 8v4M12 16h.01" />}</svg>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Health</span>
                    </div>
                    {(lowScoreCount + orphanedCount + costAnomalies.length) > 0 && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>}
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: (lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? 'var(--accent)' : (lowScoreCount + orphanedCount) > 5 ? 'var(--danger)' : 'var(--warning)', letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {(lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? '✓' : lowScoreCount + orphanedCount + costAnomalies.length}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {(lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? 'All systems healthy' : 'issues need attention'}
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: (lowScoreCount + orphanedCount + (costAnomalies.length > 0 ? 1 : 0)) === 0 ? 'var(--accent)' : 'var(--warning)', opacity: 0.6 }} />
                </div>
              </div>

              {/* Cost Comparison */}
              {costComparison && (
                <div className="card chart-card-clickable" style={{ padding: 24, position: 'relative', overflow: 'hidden' }} onClick={() => setActiveTab('costs')}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: `radial-gradient(circle at top right, ${costComparison.isIncrease ? 'rgba(244 63 94 / 0.15)' : 'rgba(16 185 129 / 0.15)'} 0%, transparent 70%)`, borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(59 130 246 / 0.3)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M23 6l-9.5 9.5-5-5L1 18" /><path d="M17 6h6v6" /></svg>
                      </div>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Month-over-Month</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Cost comparison</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#3b82f6', background: 'rgba(59 130 246 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(59 130 246 / 0.2)', cursor: 'pointer' }}>Click to view</span>
                  </div>

                  {/* Visual comparison bar */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Current Period</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Previous Period</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, height: 12, borderRadius: 6, background: 'var(--bg-surface)', overflow: 'hidden', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)' }}>
                      <div style={{ flex: costComparison.current, background: costComparison.isIncrease ? 'linear-gradient(90deg, #f43f5e 0%, #e11d48 100%)' : 'linear-gradient(90deg, #10b981 0%, #059669 100%)', borderRadius: 6, transition: 'width 0.5s ease', position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)' }} />
                      </div>
                      <div style={{ flex: costComparison.previous, background: 'linear-gradient(90deg, var(--border-strong) 0%, var(--border) 100%)', borderRadius: 6, transition: 'width 0.5s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                      <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-1)' }}>${costComparison.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-2)' }}>${costComparison.previous.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>

                  {/* Change indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20, background: `linear-gradient(135deg, var(--bg-surface) 0%, ${costComparison.isIncrease ? 'rgba(244 63 94 / 0.05)' : 'rgba(16 185 129 / 0.05)'} 100%)`, borderRadius: 16, border: '1px solid var(--border)' }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: costComparison.isIncrease ? 'linear-gradient(135deg, var(--danger-dim) 0%, rgba(244 63 94 / 0.3) 100%)' : 'linear-gradient(135deg, var(--accent-dim) 0%, rgba(16 185 129 / 0.3) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${costComparison.isIncrease ? 'var(--danger)' : 'var(--accent)'}` }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={costComparison.isIncrease ? 'var(--danger)' : 'var(--accent)'} strokeWidth="2.5">{costComparison.isIncrease ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}</svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 32, fontWeight: 900, color: costComparison.isIncrease ? 'var(--danger)' : 'var(--accent)', lineHeight: 1 }}>
                        {costComparison.isIncrease ? '+' : ''}{costComparison.percentChange.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                        {costComparison.isIncrease ? 'Increase' : 'Decrease'} of ${Math.abs(costComparison.change).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>

                  {biggestChanges.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 10 }}>Biggest Changes</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {biggestChanges.map((c, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setActiveTab('resources'); setSearchQuery(c.resourceGroup || ''); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--border-strong)'; e.currentTarget.style.transform='translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
                            <div style={{ width: 28, height: 28, borderRadius: 6, background: c.change > 0 ? 'var(--danger-dim)' : 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c.change > 0 ? 'var(--danger)' : 'var(--accent)'} strokeWidth="2.5">{c.change > 0 ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}</svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.resourceGroup || 'Unknown'}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-2)' }}>{friendlyType(c.resourceType || '')}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: c.change > 0 ? 'var(--danger)' : 'var(--accent)' }}>
                                {c.change > 0 ? '+' : ''}{c.percentChange.toFixed(0)}%
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--text-2)' }}>
                                ${Math.abs(c.change).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Charts Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
                {/* Cost by Type */}
                <div className="card chart-card-clickable" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, var(--accent-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
                      </div>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Cost by Type</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{costsByType.length} resource types</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '4px 10px', borderRadius: 12, border: '1px solid var(--accent-border)' }}>Interactive</span>
                  </div>
                  {costsByType.length > 0 ? (
                    <>
                      <div style={{ position: 'relative' }}>
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart>
                            <Pie
                              data={costsByType}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={60}
                              innerRadius={35}
                              paddingAngle={2}
                              onClick={(data) => { if (data?.name) { setActiveTab('resources'); setSearchQuery(String(data.name)); } }}
                              style={{ cursor: 'pointer' }}
                            >
                              {costsByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} style={{ cursor: 'pointer', transition: 'all 0.2s ease' }} />)}
                            </Pie>
                            <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)' }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-1)' }}>${(totalCostsSum / 1000).toFixed(0)}k</div>
                          <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 500 }}>TOTAL</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {costsByType.slice(0, 6).map((item, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)' }} onClick={() => { setActiveTab('resources'); setSearchQuery(item.name); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.background='var(--accent-dim)'; e.currentTarget.style.transform='translateY(-1px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-surface)'; e.currentTarget.style.transform='translateY(0)'; }}>
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
                            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)' }}>{item.name}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>${(item.value / 1000).toFixed(1)}k</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} message="No cost data available" />}
                </div>

                {/* Cost by Region */}
                <div className="card chart-card-clickable" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--blue-dim)', border: '1px solid rgba(59 130 246 / 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Cost by Region</span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '3px 8px', borderRadius: 4 }}>Click bars</span>
                  </div>
                  {costsByRegion.length > 0 ? (
                    <>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        {costsByRegion.slice(0, 3).map((region, i) => (
                          <div key={i} style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.2s ease' }} onClick={() => { setActiveTab('resources'); setRegionFilter([region.name]); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--blue)'; e.currentTarget.style.transform='translateY(-2px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateY(0)'; }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', marginBottom: 2 }}>#{i + 1}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>${(region.value / 1000).toFixed(1)}k</div>
                            <div style={{ fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{region.name}</div>
                          </div>
                        ))}
                      </div>
                      <ResponsiveContainer width="100%" height={Math.max(120, costsByRegion.length * 24)}>
                        <BarChart data={costsByRegion} layout="vertical" margin={{ left: 60, right: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
                          <XAxis type="number" tick={{ fill: 'var(--text-2)', fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 10 }} width={55} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)' }} cursor={{ fill: 'rgba(59 130 246 / 0.1)' }} />
                          <Bar dataKey="value" fill="var(--blue)" radius={[0, 4, 4, 0]} onClick={(data) => { if (data?.name) { setActiveTab('resources'); setRegionFilter([String(data.name)]); setCurrentPage(1); } }} style={{ cursor: 'pointer' }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </>
                  ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} message="No cost data available" />}
                </div>
              </div>

              {/* Top Spenders */}
              <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: 'radial-gradient(circle at top right, var(--danger-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(244, 63, 94, 0.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Top Cost Drivers</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Click to filter resources</span>
                    </div>
                  </div>
                  <div style={{ padding: '4px 10px', background: 'var(--danger-dim)', borderRadius: 12, border: '1px solid rgba(244 63 94 / 0.2)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}>${topSpenders.reduce((s, c) => s + c.cost, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                {topSpenders.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {topSpenders.map((c, i) => {
                      const maxCost = topSpenders[0]?.cost || 1;
                      const percentage = maxCost > 0 ? (c.cost / maxCost) * 100 : 0;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); setSearchQuery(c.resourceGroup || ''); }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(244 63 94 / 0.15)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percentage}%`, background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}15, transparent)`, transition: 'width 0.5s ease' }} />
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, ${COLORS[i % COLORS.length]}, ${COLORS[(i + 1) % COLORS.length]})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0, zIndex: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.resourceGroup || 'Unknown'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{friendlyType(c.resourceType || '')}</div>
                          </div>
                          <div style={{ textAlign: 'right', zIndex: 1 }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 14 }}>${c.cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{totalCostsSum > 0 ? ((c.cost / totalCostsSum) * 100).toFixed(1) : '0'}%</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} message="No cost data available" />}
              </div>

              {/* Cost by Subscription */}
              <div className="card chart-card-clickable" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: 'radial-gradient(circle at top right, rgba(139 92 246 / 0.15) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139 92 246 / 0.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Cost by Subscription</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{costsBySubscription.length} subscriptions</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#8b5cf6', background: 'rgba(139 92 246 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(139 92 246 / 0.2)' }}>Interactive</span>
                </div>
                {costsBySubscription.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {costsBySubscription.slice(0, 5).map((sub, i) => {
                      const maxVal = costsBySubscription[0]?.value || 1;
                      const percentage = maxVal > 0 ? (sub.value / maxVal) * 100 : 0;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }} onClick={() => { const fullId = uniqueSubs.find(s => s.startsWith(sub.name)); if (fullId) { setActiveTab('resources'); setSubFilter([fullId]); setCurrentPage(1); }}} onMouseEnter={e => { e.currentTarget.style.borderColor = '#8b5cf6'; e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(139 92 246 / 0.15)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percentage}%`, background: `linear-gradient(90deg, rgba(139 92 246 / 0.12), transparent)`, transition: 'width 0.5s ease' }} />
                          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>{sub.name}</div>
                          <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', zIndex: 1 }}>
                            <div style={{ height: '100%', width: `${percentage}%`, background: 'linear-gradient(90deg, #8b5cf6, #a78bfa)', borderRadius: 4, transition: 'width 0.5s ease' }} />
                          </div>
                          <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 13, minWidth: 65, textAlign: 'right', zIndex: 1 }}>${(sub.value / 1000).toFixed(1)}k</div>
                        </div>
                      );
                    })}
                    {costsBySubscription.length > 5 && (
                      <div style={{ textAlign: 'center', padding: '10px', color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-surface)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                        +{costsBySubscription.length - 5} more subscriptions
                      </div>
                    )}
                  </div>
                ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} message="No cost data available" />}
              </div>

              {/* Cost by Environment Tag */}
              {costsByEnvironment.length > 0 && costsByEnvironment.some(e => e.name !== 'Untagged') && (
                <div className="card chart-card-clickable" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(236 72 153 / 0.3)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
                      </div>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Cost by Environment</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Tagged resources</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#ec4899', background: 'rgba(236 72 153 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(236 72 153 / 0.2)' }}>Interactive</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: '50%' }}>
                      <ResponsiveContainer width="100%" height={120}>
                        <PieChart>
                          <Pie data={costsByEnvironment.filter(e => e.name !== 'Untagged')} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} innerRadius={25} paddingAngle={2} style={{ cursor: 'pointer' }}>
                            {costsByEnvironment.filter(e => e.name !== 'Untagged').map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} style={{ cursor: 'pointer', transition: 'all 0.2s ease' }} />)}
                          </Pie>
                          <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {costsByEnvironment.filter(e => e.name !== 'Untagged').map((env, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)' }} onMouseEnter={e => { e.currentTarget.style.borderColor=COLORS[i % COLORS.length]; e.currentTarget.style.transform='translateX(3px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
                          <div style={{ width: 12, height: 12, borderRadius: 4, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', flex: 1 }}>{env.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>${(env.value / 1000).toFixed(1)}k</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Resource Distribution by Cost Tier */}
              <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: 'radial-gradient(circle at top right, rgba(34 197 94 / 0.15) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(34 197 94 / 0.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Resources by Cost Tier</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Click to filter</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {resourceAgeDistribution.map((group, i) => {
                    const counts = resourceAgeDistribution.map(g => g.count);
                    const maxCount = counts.length > 0 ? Math.max(...counts) : 1;
                    const percentage = maxCount > 0 ? (group.count / maxCount) * 100 : 0;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); }} onMouseEnter={e => { e.currentTarget.style.borderColor = group.color; e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${group.color}25`; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percentage}%`, background: `linear-gradient(90deg, ${group.color}15, transparent)`, transition: 'width 0.5s ease' }} />
                        <div style={{ width: 14, height: 14, borderRadius: 4, background: group.color, flexShrink: 0, zIndex: 1 }} />
                        <div style={{ flex: 1, zIndex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)' }}>{group.label}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${percentage}%`, background: group.color, borderRadius: 2, transition: 'width 0.5s ease' }} />
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{group.count}</span>
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 13, textAlign: 'right', zIndex: 1 }}>
                          ${group.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Daily Cost Trends */}
              <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'radial-gradient(circle at top right, rgba(6 182 212 / 0.15) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(6 182 212 / 0.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Daily Cost Trends</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>30-day rolling view</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6 182 212 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(6 182 212 / 0.2)' }}>Interactive</span>
                </div>
                {Array.isArray(dailyCosts) && dailyCosts.length > 0 && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    {(() => {
                      const costs = dailyCosts.map(d => d.cost);
                      const avg = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
                      const max = costs.length > 0 ? Math.max(...costs) : 0;
                      const trend = costs.length > 1 && costs[0] > 0 ? ((costs[costs.length - 1] - costs[0]) / costs[0]) * 100 : 0;
                      return (
                        <>
                          <div style={{ flex: 1, padding: '12px 14px', background: 'linear-gradient(135deg, var(--bg-surface) 0%, rgba(16 185 129 / 0.05) 100%)', borderRadius: 10, border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, background: 'radial-gradient(circle at top right, var(--accent-dim) 0%, transparent 70%)', borderRadius: '0 8px 0 100%' }} />
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Average</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-1)', lineHeight: 1 }}>${avg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>per day</div>
                          </div>
                          <div style={{ flex: 1, padding: '12px 14px', background: 'linear-gradient(135deg, var(--bg-surface) 0%, rgba(244 63 94 / 0.05) 100%)', borderRadius: 10, border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, background: 'radial-gradient(circle at top right, var(--danger-dim) 0%, transparent 70%)', borderRadius: '0 8px 0 100%' }} />
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Peak</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--danger)', lineHeight: 1 }}>${max.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>highest day</div>
                          </div>
                          <div style={{ flex: 1, padding: '12px 14px', background: `linear-gradient(135deg, var(--bg-surface) 0%, ${trend >= 0 ? 'rgba(244 63 94 / 0.05)' : 'rgba(16 185 129 / 0.05)'} 100%)`, borderRadius: 10, border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, background: `radial-gradient(circle at top right, ${trend >= 0 ? 'var(--danger-dim)' : 'var(--accent-dim)'} 0%, transparent 70%)`, borderRadius: '0 8px 0 100%' }} />
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Trend</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: trend >= 0 ? 'var(--danger)' : 'var(--accent)', lineHeight: 1 }}>
                              {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>vs start</div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
                {Array.isArray(dailyCosts) && dailyCosts.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={dailyCosts} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <defs>
                        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25}/>
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#06b6d4"/>
                          <stop offset="50%" stopColor="var(--accent)"/>
                          <stop offset="100%" stopColor="#8b5cf6"/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-3)', fontSize: 9 }} tickFormatter={v => v ? v.slice(5) : ''} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} labelFormatter={(l: unknown) => String(l)} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)' }} />
                      <Line type="monotone" dataKey="cost" stroke="url(#lineGradient)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg-card)', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>} message="No trend data available" />}
              </div>

              {/* Optimization Opportunities */}
              {optimizationOpportunities.length > 0 && (
                <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden', borderLeft: lowScoreCount + orphanedCount > 5 ? '4px solid var(--danger)' : '4px solid var(--warning)' }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, var(--danger-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(244 63 94 / 0.3)' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      </div>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Optimization Opportunities</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{optimizationOpportunities.length} items need attention</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '6px 14px', borderRadius: 12, background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)', color: 'white', fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(16 185 129 / 0.3)' }}>
                        ${totalPotentialSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {optimizationOpportunities.slice(0, 5).map((o, i) => {
                      const maxSavings = optimizationOpportunities[0]?.potentialSavings || 1;
                      const percentage = maxSavings > 0 ? (o.potentialSavings / maxSavings) * 100 : 0;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); setSearchQuery(o.resource.name); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--danger)'; e.currentTarget.style.transform='translateX(4px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(244 63 94 / 0.15)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percentage}%`, background: 'linear-gradient(90deg, rgba(244 63 94 / 0.08), transparent)', transition: 'width 0.5s ease' }} />
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--danger-dim) 0%, rgba(244 63 94 / 0.3) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1, border: '1px solid rgba(244 63 94 / 0.2)' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2"><path d="M12 9v2M12 13h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.resource.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{o.reason}</div>
                          </div>
                          <div style={{ textAlign: 'right', zIndex: 1 }}>
                            <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 16 }}>${o.potentialSavings.toFixed(0)}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>per month</div>
                          </div>
                        </div>
                      );
                    })}
                    {optimizationOpportunities.length > 5 && (
                      <div style={{ textAlign: 'center', padding: '10px', color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-surface)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                        +{optimizationOpportunities.length - 5} more opportunities
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Resource Topology */}
              <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, rgba(245 158 11 / 0.15) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(245 158 11 / 0.3)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" /></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Resource Topology</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>By resource group</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', background: 'rgba(245 158 11 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(245 158 11 / 0.2)' }}>Interactive</span>
                </div>
                {resourceTopology.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {resourceTopology.slice(0, 6).map((rg, i) => {
                      const maxCost = resourceTopology[0]?.cost || 1;
                      const costPercent = maxCost > 0 ? (rg.cost / maxCost) * 100 : 0;
                      return (
                        <div key={i} style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 14, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); setRgFilter([rg.name]); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--warning-border)'; e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='none'; }}>
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(245 158 11 / 0.6), rgba(245 158 11 / ${costPercent / 100 * 0.4}))` }} />
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rg.name}>{rg.name}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                            {rg.types.slice(0, 3).map((t, j) => (
                              <span key={j} style={{ fontSize: 10, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '3px 8px', borderRadius: 4, fontWeight: 500 }}>{t.type} ({t.count})</span>
                            ))}
                            {rg.types.length > 3 && <span style={{ fontSize: 10, background: 'var(--bg-hover)', color: 'var(--text-3)', padding: '3px 8px', borderRadius: 4 }}>+{rg.types.length - 3}</span>}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-2)', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                              {rg.count}
                            </div>
                            <span style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 12 }}>${rg.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</span>
                          </div>
                        </div>
                      );
                    })}
                    {resourceTopology.length > 6 && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', borderRadius: 12, padding: 14, border: '1px dashed var(--border)', cursor: 'pointer', transition: 'all 0.2s ease' }} onClick={() => { setActiveTab('resources'); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--border-strong)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; }}>
                        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>+{resourceTopology.length - 6} more groups</span>
                      </div>
                    )}
                  </div>
                ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>} message="No resources loaded" />}
              </div>

              {/* Reserved Instance Recommendations */}
              {riRecommendations.length > 0 && (
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--blue-dim)', border: '1px solid rgba(59 130 246 / 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Reserved Instance Savings</span>
                    <div style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 12, background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
                      ${riRecommendations.reduce((s, r) => s + r.yearlySavings, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr potential
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>
                    Resources with consistent usage could benefit from Azure Reserved Instances (up to 72% savings)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {riRecommendations.map((r, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setRgFilter([r.resourceGroup]); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--blue)'; e.currentTarget.style.transform='translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.resourceGroup}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{r.region}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Save ${r.yearlySavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</div>
                          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>${r.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo current</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost Anomalies */}
              {costAnomalies.length > 0 && (
                <div className="card" style={{ padding: 24, borderLeft: '4px solid var(--danger)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(244 63 94 / 0.03) 100%)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--danger-dim)', border: '1px solid rgba(244 63 94 / 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Cost Anomalies Detected</span>
                    <span style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 12, background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 11, fontWeight: 700 }}>
                      {costAnomalies.length} spike{costAnomalies.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>
                    Resources with significant cost increases (&gt;50%) compared to previous period
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {costAnomalies.map((a, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setSearchQuery(a.resourceGroup); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--danger)'; e.currentTarget.style.transform='translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: a.severity === 'high' ? 'var(--danger-dim)' : 'var(--warning-dim)',
                          color: a.severity === 'high' ? 'var(--danger)' : 'var(--warning)',
                          fontSize: 12, fontWeight: 700
                        }}>
                          {a.severity === 'high' ? '!!' : '!'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.resourceGroup}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{friendlyType(a.resourceType)} · {a.location}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>+{a.spike.toFixed(0)}%</div>
                          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                            ${a.previousCost.toFixed(0)} → ${a.currentCost.toFixed(0)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'resources' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Search */}
                <div className="search-input-wrap" style={{ maxWidth: 340 }}>
                  <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  <input
                    className="search-input"
                    type="text"
                    placeholder="Search by name, type, resource group..."
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  />
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 20, marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="stat-pill">
                    <span className="stat-label">Filtered Cost</span>
                    <span className="stat-value">${filteredTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="stat-pill">
                    <span className="stat-label">Resources</span>
                    <span className="stat-value neutral">{totalResources.toLocaleString()}</span>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={exportCSV}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      Export CSV
                    </button>
                    {costsLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', padding: '0 8px' }}>
                        <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        {`${new Set(costs.map(c => c.subscriptionId)).size}/${uniqueSubs.length} subs`}
                      </div>
                    ) : (
                      <button className="btn" onClick={() => { setCosts([]); fetchCosts(true); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                        Refresh Costs
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Table */}
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12, color: 'var(--text-2)', fontSize: 13 }}>
                  <div className="spinner" />
                  Scanning Azure infrastructure...
                </div>
              ) : (
                <ResourceTable
                  resources={resources}
                  sortConfig={sortConfig}
                  onSort={handleSort}
                  onLocationClick={loc => { setRegionFilter([loc]); setCurrentPage(1); }}
                  onRgClick={rg => { setRgFilter([rg]); setCurrentPage(1); }}
                  onSubClick={sub => { setSubFilter([sub]); setCurrentPage(1); }}
                  onTypeClick={type => { setTypeFilter(type); setCurrentPage(1); }}
                  onResourceClick={r => { setSelectedResource(r); fetchAIInsights(r); }}
                />
              )}

              {/* Pagination */}
              {!loading && totalPages > 1 && (
                <div className="pagination">
                  <button className="page-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>«</button>
                  <button className="page-btn" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>‹</button>
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    const page = totalPages <= 7 ? i + 1 : currentPage <= 4 ? i + 1 : currentPage >= totalPages - 3 ? totalPages - 6 + i : currentPage - 3 + i;
                    return (
                      <button key={page} className={`page-btn ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)}>{page}</button>
                    );
                  })}
                  <button className="page-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>›</button>
                  <button className="page-btn" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>»</button>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 4 }}>
                    {((currentPage - 1) * itemsPerPage) + 1}–{Math.min(currentPage * itemsPerPage, totalResources)} of {totalResources.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          ) : activeTab === 'history' ? (
            /* ── History Tab ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* History Header */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139 92 246 / 0.1)', border: '1px solid rgba(139 92 246 / 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.5"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
                    </div>
                    <div>
                      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--text-1)' }}>Resource Change History</h2>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-2)' }}>Track changes to your Azure resources over time</p>
                    </div>
                  </div>
                  <button className="btn" onClick={() => fetchHistory()} disabled={historyLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {historyLoading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>}
                    Refresh
                  </button>
                </div>
              </div>

              {/* History Timeline */}
              {historyLoading && history.length === 0 ? (
                <div className="card" style={{ padding: 60, textAlign: 'center' }}>
                  <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
                  <div style={{ color: 'var(--text-2)', fontSize: 13 }}>Loading history...</div>
                </div>
              ) : history.length === 0 ? (
                <div className="card" style={{ padding: 60, textAlign: 'center' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.5 }}>
                    <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                  </svg>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>No changes recorded yet</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 320, margin: '0 auto' }}>
                    Changes will be tracked when resources are created, modified, or deleted.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {history.map((h, i) => {
                    const isCreated = h.changeType === 'created';
                    const isDeleted = h.changeType === 'deleted';
                    const bgColor = isCreated ? 'var(--accent-dim)' : isDeleted ? 'var(--danger-dim)' : 'var(--blue-dim)';
                    const borderColor = isCreated ? 'var(--accent)' : isDeleted ? 'var(--danger)' : 'var(--blue)';
                    const iconColor = isCreated ? 'var(--accent)' : isDeleted ? 'var(--danger)' : 'var(--blue)';

                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 16,
                          padding: 16,
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          borderLeft: `3px solid ${borderColor}`,
                          borderRadius: 12,
                          transition: 'all 0.2s ease',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.transform = 'translateX(4px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)'; }}
                      >
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: bgColor,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: `1px solid ${borderColor}33`
                        }}>
                          {isCreated ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                          ) : isDeleted ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2.5"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              background: bgColor,
                              color: iconColor,
                              border: `1px solid ${borderColor}33`
                            }}>
                              {h.changeType}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 500 }}>
                              {new Date(h.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
                            {h.resourceName}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                            {isCreated ? (
                              <span style={{ color: 'var(--accent)' }}>New resource added to inventory</span>
                            ) : isDeleted ? (
                              <span style={{ color: 'var(--danger)' }}>Resource removed from inventory</span>
                            ) : (
                              <span>
                                <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{h.field}</span>
                                {': '}
                                <span style={{ color: 'var(--danger)' }}>{h.oldValue || '(empty)'}</span>
                                <span style={{ margin: '0 6px', color: 'var(--text-3)' }}>→</span>
                                <span style={{ color: 'var(--accent)' }}>{h.newValue || '(empty)'}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Cost Tab ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Search */}
                <div className="search-input-wrap" style={{ maxWidth: 300 }}>
                  <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  <input
                    className="search-input"
                    type="text"
                    placeholder="Search by RG, type, location..."
                    value={costSearchQuery}
                    onChange={e => setCostSearchQuery(e.target.value)}
                  />
                </div>

                <div style={{ flex: 1 }} />

                {/* Stats */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Total Cost</div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.02em' }}>${totalCostsSum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={exportCostsCSV}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      Export CSV
                    </button>
                    {costsLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', padding: '0 8px' }}>
                        <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        {`${new Set(costs.map(c => c.subscriptionId)).size}/${uniqueSubs.length} subs`}
                      </div>
                    ) : (
                      <button className="btn" onClick={() => { setCosts([]); fetchCosts(true); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                        Refresh Costs
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Cost summary */}
              {filteredCosts.length !== costs.length && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      Showing <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{filteredCosts.length}</span> of <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{costs.length}</span> cost entries
                    </span>
                  </div>
                  <button onClick={() => setCostSearchQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 6 }}>
                    Clear search
                  </button>
                </div>
              )}

              {costsLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12, color: 'var(--text-2)', fontSize: 13 }}>
                  <div className="spinner" />
                  Syncing financial data ({new Set(costs.map(c => c.subscriptionId)).size}/{uniqueSubs.length} subscriptions)...
                </div>
              )}

              {!costsLoading && filteredCosts.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {[...filteredCosts].sort((a, b) => b.cost - a.cost).map((c, i) => {
                    const trendUp = c.trend !== undefined && c.trend > 0;

                    return (
                      <button
                        key={i}
                        className="cost-card"
                        onClick={() => setSelectedCost(c)}
                        style={{ position: 'relative', textAlign: 'left', width: '100%' }}
                      >
                        {/* Trend indicator */}
                        {c.trend !== undefined && c.trend !== 0 && (
                          <div style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            borderRadius: 20,
                            fontSize: 11,
                            fontWeight: 700,
                            background: trendUp ? 'var(--danger-dim)' : 'var(--accent-dim)',
                            color: trendUp ? 'var(--danger)' : 'var(--accent)',
                            border: `1px solid ${trendUp ? 'var(--danger)' : 'var(--accent)'}33`
                          }}>
                            {trendUp ? (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                            ) : (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                            )}
                            {Math.abs(c.trend).toFixed(1)}%
                          </div>
                        )}

                        {/* Cost amount */}
                        <div className="cost-amount">${c.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

                        {/* Resource type with colored icon */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                          <div style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: 'var(--accent-dim)',
                            border: '1px solid var(--accent-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <path d="M3 9h18M9 21V9" />
                            </svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 2 }}>
                              {friendlyType(c.resourceType || '')}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.resourceGroup || '—'}
                            </div>
                          </div>
                        </div>

                        {/* Location tag */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: 'var(--text-2)' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                            {c.resourceLocation}
                          </div>
                        </div>

                        {/* Previous cost comparison */}
                        {c.previousCost !== undefined && c.previousCost > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Previous period</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 700 }}>
                                ${c.previousCost.toFixed(2)}
                              </span>
                              {c.cost !== c.previousCost && (
                                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: c.cost > c.previousCost ? 'var(--danger-dim)' : 'var(--accent-dim)', color: c.cost > c.previousCost ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                                  {c.cost > c.previousCost ? '+' : ''}{((c.cost - c.previousCost) / c.previousCost * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {!costsLoading && costs.length === 0 && (
                <div className="card" style={{ padding: 60, textAlign: 'center' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.5 }}>
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>No cost data available</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Click Refresh Costs to load financial data from Azure.</div>
                </div>
              )}

              {!costsLoading && costs.length > 0 && filteredCosts.length === 0 && (
                <div className="card" style={{ padding: 60, textAlign: 'center' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="1.5" style={{ margin: '0 auto 16px', opacity: 0.5 }}>
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>No matching costs found</div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Try adjusting your search query.</div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Cost detail modal ── */}
      {selectedCost && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setSelectedCost(null)}>
          <div className="modal" style={{ maxWidth: 900 }}>
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>
                  {selectedCost.resourceGroup || '—'} / {friendlyType(selectedCost.resourceType || '')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
                  ${selectedCost.cost.toFixed(2)} past 30 days · {selectedCost.resourceLocation}
                </div>
              </div>
              <button className="modal-close" onClick={() => setSelectedCost(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto' }}>
              <ResourceTable
                resources={detailResources}
                sortConfig={sortConfig}
                onSort={handleSort}
                onLocationClick={() => {}}
                onRgClick={() => {}}
                onSubClick={() => {}}
                onTypeClick={type => setTypeFilter(type)}
                onResourceClick={r => { setSelectedCost(null); setSelectedResource(r); fetchAIInsights(r); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── AI Insights modal ── */}
      {selectedResource && (
        <AIInsightsModal
          resource={selectedResource}
          onClose={() => setSelectedResource(null)}
          insight={aiInsight}
          loading={aiLoading}
        />
      )}

      {/* ── Settings modal ── */}
      {showSettings && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>Budget Settings</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Configure monthly spending limits</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowSettings(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Monthly Budget Limit ($)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-2)', fontWeight: 600, fontSize: 14 }}>$</span>
                  <input
                    type="number"
                    value={budgetLimit || ''}
                    onChange={e => saveBudget(parseFloat(e.target.value) || 0)}
                    placeholder="e.g., 10000"
                    style={{ width: '100%', padding: '12px 12px 12px 28px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 16, fontWeight: 600, transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }}
                    onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)'; }}
                    onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                  />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                  Set your monthly cloud budget to receive alerts when approaching the limit
                </div>
              </div>

              {budgetLimit > 0 && (
                <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Current Status</div>
                    <div style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: budgetStatus?.color === 'var(--accent)' ? 'var(--accent-dim)' : budgetStatus?.color === 'var(--warning)' ? 'var(--warning-dim)' : 'var(--danger-dim)', color: budgetStatus?.color || 'var(--accent)' }}>
                      {budgetStatus?.message || 'On track'}
                    </div>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
                    ${totalCostsSum.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-3)' }}> / ${budgetLimit.toLocaleString()}</span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginTop: 12 }}>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, (totalCostsSum / budgetLimit) * 100)}%`,
                          background: budgetStatus?.color || 'var(--accent)',
                          borderRadius: 4,
                          transition: 'width 0.5s ease'
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-3)' }}>
                      <span>0%</span>
                      <span>{Math.min(100, ((totalCostsSum / budgetLimit) * 100)).toFixed(0)}%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                    <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Remaining</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: budgetLimit - totalCostsSum > 0 ? 'var(--accent)' : 'var(--danger)', marginTop: 2 }}>
                        ${Math.max(0, budgetLimit - totalCostsSum).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div style={{ padding: 12, borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Days Left</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', marginTop: 2 }}>
                        {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowSettings(false)}
                className="btn btn-primary"
                style={{ padding: '12px 20px', justifyContent: 'center' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error toast ── */}
      {error && !loading && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 300,
          background: 'var(--bg-card)', border: '1px solid var(--danger)',
          borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: 'var(--shadow-md)', maxWidth: 380, animation: 'slideUp 0.3s ease',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
          </svg>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Error</div>
            <div style={{ fontSize: 13, color: 'var(--text-1)', marginTop: 2 }}>{error}</div>
          </div>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* ── Full-screen loading ── */}
      {loading && resources.length === 0 && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ width: 64, height: 64, border: '3px solid var(--border-strong)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <div style={{ position: 'absolute', inset: 0, width: 64, height: 64, border: '3px solid transparent', borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            <div style={{ position: 'absolute', inset: 8, width: 48, height: 48, background: 'var(--bg-surface)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 9.2a7 7 0 0 1-9 8.8Z" />
                <path d="M7 20s-2-3-2-8" />
                <path d="M11 20s2-4 2-9h4" />
              </svg>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-1)', letterSpacing: '-0.02em' }}>Initializing CloudViz</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              Scanning Azure Infrastructure
            </div>
          </div>
        </div>
      )}
    </>
  );
}
