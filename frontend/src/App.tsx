import { useState, useEffect, useMemo, useRef, Component, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area, Brush, ReferenceArea } from 'recharts';
import { jsPDF } from 'jspdf';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';

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

// Keyboard shortcut definitions
interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
}

function useKeyboardShortcuts(shortcuts: ShortcutConfig[], enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Escape key even in inputs
        if (e.key !== 'Escape') return;
      }

      for (const shortcut of shortcuts) {
        const isCtrl = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !e.ctrlKey && !e.metaKey;
        const isShift = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const isAlt = shortcut.alt ? e.altKey : !e.altKey;

        if (e.key.toLowerCase() === shortcut.key.toLowerCase() && isCtrl && isShift && isAlt) {
          e.preventDefault();
          shortcut.action();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
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
  resourceType: string;
  changeType: string;
  field: string;
  oldValue: string;
  newValue: string;
  timestamp: string;
  cost: number;
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

// Infer environment from resource group name
const inferEnvFromRG = (rg: string): string => {
  if (!rg) return 'Unknown';
  const low = rg.toLowerCase();
  if (low.includes('prod') || low.includes('production')) return 'Production';
  if (low.includes('dev') || low.includes('development')) return 'Development';
  if (low.includes('stag') || low.includes('staging')) return 'Staging';
  if (low.includes('test') || low.includes('qa') || low.includes('uat')) return 'Test/QA';
  if (low.includes('dr') || low.includes('disaster') || low.includes('backup')) return 'DR';
  return 'Unknown';
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
  const lastVal = validData[validData.length - 1];
  const prevVal = validData[validData.length - 2] || lastVal;
  const trendUp = lastVal >= prevVal;
  return (
    <svg width={W} height={H} style={{ overflow: 'visible', flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={trendUp ? 'var(--accent)' : 'var(--danger)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// ─── Score ring ───────────────────────────────────────────────────────────────

const ScoreRing = ({ score }: { score: number }) => {
  const r = 12, circ = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--accent)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  const glowColor = score >= 80 ? 'rgba(16 185 129 / 0.4)' : score >= 50 ? 'rgba(245 158 11 / 0.4)' : 'rgba(244 63 94 / 0.4)';
  return (
    <svg width={30} height={30} className="score-ring" style={{ flexShrink: 0, filter: `drop-shadow(0 0 4px ${glowColor})` }}>
      <circle cx={15} cy={15} r={r} fill="none" stroke="var(--border-strong)" strokeWidth="2.5" />
      <circle cx={15} cy={15} r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={circ - (score / 100) * circ}
        strokeLinecap="round" transform="rotate(-90 15 15)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
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

  // Compute dropdown position based on current ref position
  const rect = ref.current?.getBoundingClientRect();
  const dropdownStyle = {
    position: 'fixed' as const,
    top: (rect?.bottom ?? 0) + 4,
    left: rect?.left ?? 0,
    width: Math.max(rect?.width ?? 0, 220),
    maxHeight: 300,
    zIndex: 900,
  };

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

  // Compute dropdown position based on current ref position
  const rect = ref.current?.getBoundingClientRect();
  const dropdownStyle = {
    position: 'fixed' as const,
    top: (rect?.bottom ?? 0) + 4,
    left: rect?.left ?? 0,
    width: Math.max(rect?.width ?? 0, 220),
    maxHeight: 300,
    zIndex: 900,
  };

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
  favorites?: Set<string>;
  onToggleFavorite?: (id: string) => void;
  selected?: Set<string>;
  onSelect?: (id: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  onBulkExport?: (ids: string[]) => void;
}

const COLUMNS = [
  { key: 'select',         label: '',               defaultW: 36, minWidth: 36 },
  { key: 'favorite',       label: '',               defaultW: 36, minWidth: 36 },
  { key: 'name',           label: 'Name',           defaultW: 120, minWidth: 80 },
  { key: 'type',           label: 'Type',          defaultW: 100, minWidth: 60 },
  { key: 'location',       label: 'Location',       defaultW: 80, minWidth: 50 },
  { key: 'resourceGroup',  label: 'Resource Group', defaultW: 100, minWidth: 60 },
  { key: 'subscriptionId', label: 'Subscription ID',  defaultW: 90, minWidth: 60 },
  { key: 'optimization',   label: 'Efficiency',         defaultW: 70, minWidth: 50 },
  { key: 'cost',           label: 'Cost',          defaultW: 80, minWidth: 60 },
];

function ResourceTable({ resources, sortConfig, onSort, onLocationClick, onRgClick, onSubClick, onTypeClick, onResourceClick, favorites, onToggleFavorite, selected, onSelect, onSelectAll, onBulkExport }: ResourceTableProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>(
    Object.fromEntries(COLUMNS.map(c => [c.key, c.defaultW]))
  );
  const [listWidth, setListWidth] = useState(0);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const update = () => {
      if (wrapRef.current) {
        const availableW = wrapRef.current.clientWidth - 32;
        const totalDefault = COLUMNS.reduce((sum, c) => sum + c.defaultW, 0);
        const totalMin = COLUMNS.reduce((sum, c) => sum + (c as typeof COLUMNS[0] & { minWidth: number }).minWidth, 0);
        setListWidth(wrapRef.current.clientWidth);

        if (availableW < totalMin) {
          setWidths(Object.fromEntries(COLUMNS.map(c => [c.key, (c as typeof COLUMNS[0] & { minWidth: number }).minWidth])));
        } else if (availableW < totalDefault) {
          const scale = (availableW - totalMin) / (totalDefault - totalMin);
          setWidths(Object.fromEntries(COLUMNS.map(c => {
            const minW = (c as typeof COLUMNS[0] & { minWidth: number }).minWidth;
            return [c.key, Math.round(minW + (c.defaultW - minW) * scale)];
          })));
        } else {
          const scale = availableW / totalDefault;
          setWidths(Object.fromEntries(COLUMNS.map(c => [c.key, Math.floor(c.defaultW * scale)])));
        }
      }
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
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

  // Calculate selection state
  const allSelected = resources.length > 0 && resources.every(r => selected?.has(r.id));
  const someSelected = resources.some(r => selected?.has(r.id)) && !allSelected;

  const Row = ({ index, style, data }: ListChildComponentProps) => {
    const { resources, widths, selected, favorites, onSelect, onToggleFavorite, onResourceClick, onLocationClick, onRgClick, onSubClick, onTypeClick } = data as any;
    const r = resources[index] as AzureResource;
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center' }} className="resource-table-virtual-row">
        <div style={{ width: widths.select, textAlign: 'center', flexShrink: 0, padding: '0 14px' }}>
          {onSelect && (
            <input
              type="checkbox"
              checked={selected?.has(r.id) || false}
              onChange={e => onSelect(r.id, e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
          )}
        </div>
        <div style={{ width: widths.favorite, textAlign: 'center', flexShrink: 0, padding: '0 14px' }}>
          {onToggleFavorite && (
            <button
              onClick={() => onToggleFavorite(r.id)}
              title={favorites?.has(r.id) ? 'Remove from favorites' : 'Add to favorites'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, transition: 'all 0.2s ease', opacity: favorites?.has(r.id) ? 1 : 0.4 }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = favorites?.has(r.id) ? '1' : '0.4'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={favorites?.has(r.id) ? '#fbbf24' : 'none'} stroke={favorites?.has(r.id) ? '#fbbf24' : 'currentColor'} strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          )}
        </div>
        <div style={{ width: widths.name, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <button onClick={() => onResourceClick(r)} title={r.name} className="resource-name-link cell-truncate" style={{ fontWeight: 600 }}>
              {r.name}
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(r.id)}
              title={`Copy Resource ID: ${r.id}`}
              style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: 0.6, transition: 'opacity 0.2s ease' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              ID
            </button>
          </div>
        </div>
        <div style={{ width: widths.type, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          <button className="badge badge-type cell-truncate" onClick={() => onTypeClick(r.type)} title={friendlyType(r.type)}>
            {friendlyType(r.type)}
          </button>
        </div>
        <div style={{ width: widths.location, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          <button className="badge badge-loc cell-truncate" onClick={() => onLocationClick(r.location)} title={r.location}>
            {r.location}
          </button>
        </div>
        <div style={{ width: widths.resourceGroup, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          <button className="badge badge-rg cell-truncate" onClick={() => onRgClick(r.resourceGroup)} title={r.resourceGroup}>
            {r.resourceGroup}
          </button>
        </div>
        <div style={{ width: widths.subscriptionId, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          <button onClick={() => onSubClick(r.subscriptionId)} title={r.subscriptionId} className="cell-truncate" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-2)', width: '100%', textAlign: 'left' }}>
            {r.subscriptionId}
          </button>
        </div>
        <div style={{ width: widths.optimization, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ScoreRing score={r.score ?? 100} />
            {r.optimization && (
              <span className="badge badge-opt" style={{ fontSize: 9, padding: '2px 6px' }}>
                {r.optimization}
              </span>
            )}
          </div>
        </div>
        <div style={{ width: widths.cost, flexShrink: 0, padding: '0 14px', textAlign: 'right' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
            ${(r.cost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    );
  };

  const itemData = useMemo(() => ({
    resources, widths, selected, favorites,
    onSelect, onToggleFavorite, onResourceClick,
    onLocationClick, onRgClick, onSubClick, onTypeClick
  }), [resources, widths, selected, favorites, onSelect, onToggleFavorite, onResourceClick, onLocationClick, onRgClick, onSubClick, onTypeClick]);

  const HEADER_HEIGHT = 40;
  const LIST_HEIGHT = 540;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Bulk Actions Bar */}
      {selected && selected.size > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)',
          borderRadius: 10,
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
              {selected.size} selected
            </span>
            <button
              onClick={() => onSelectAll?.(false)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-2)',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onBulkExport?.(Array.from(selected))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid var(--accent)',
                background: 'var(--accent)',
                color: 'white',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>
      )}
      <div ref={wrapRef} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', overflow: 'hidden', height: LIST_HEIGHT }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', height: HEADER_HEIGHT, flexShrink: 0 }} className="resource-table-virtual-header">
          {COLUMNS.map(c => (
            <div key={c.key} className={sortConfig.key === c.key ? 'sorted' : ''} onClick={() => c.key !== 'select' && onSort(c.key)} style={{ position: 'relative', width: widths[c.key], textAlign: c.key === 'cost' ? 'right' : c.key === 'select' || c.key === 'favorite' ? 'center' : 'left', flexShrink: 0, padding: '10px 14px', cursor: c.key !== 'select' ? 'pointer' : 'default' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 12, justifyContent: c.key === 'cost' ? 'flex-end' : c.key === 'select' || c.key === 'favorite' ? 'center' : 'flex-start' }}>
                {c.key === 'select' && onSelectAll ? (
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={e => onSelectAll(e.target.checked)}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: 16,
                      height: 16,
                      cursor: 'pointer',
                      accentColor: 'var(--accent)'
                    }}
                  />
                ) : c.label}
                {sortConfig.key === c.key && c.key !== 'select' && c.key !== 'favorite' && (
                  <span style={{ color: 'var(--accent)', fontSize: 10 }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                )}
              </span>
              {c.key !== 'select' && c.key !== 'favorite' && (
                <span className="col-resize-handle" onMouseDown={e => startResize(c.key, e)} onClick={e => e.stopPropagation()} />
              )}
            </div>
          ))}
        </div>
        {/* Virtual Body */}
        {resources.length > 0 && listWidth > 0 ? (
          <FixedSizeList
            height={LIST_HEIGHT - HEADER_HEIGHT}
            itemCount={resources.length}
            itemSize={48}
            itemData={itemData}
            width={listWidth}
            className="resource-table-virtual-list"
          >
            {Row}
          </FixedSizeList>
        ) : resources.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: LIST_HEIGHT - HEADER_HEIGHT }}>
            <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>} message="No resources matched your criteria" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── AIInsightsModal ──────────────────────────────────────────────────────────

function AIInsightsModal({ resource, onClose, insight, loading, onViewDependencies }: {
  resource: AzureResource; onClose: () => void; insight: { metrics: MetricSeries; recommendations: Array<{category: string; action: string; estimatedSavings: number; savingsPercent: number; rationale: string; priority: number}> } | null; loading: boolean; onViewDependencies?: () => void;
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
              <button
                onClick={() => navigator.clipboard.writeText(resource.id)}
                title={`Copy Resource ID: ${resource.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-2)',
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'monospace'
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy ID
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {onViewDependencies && (
              <button
                onClick={onViewDependencies}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="3" />
                  <circle cx="5" cy="19" r="3" />
                  <circle cx="19" cy="19" r="3" />
                  <path d="M12 8v3M7 16h6m4 0h-6" />
                </svg>
                View Dependencies
              </button>
            )}
            <button className="modal-close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="info-grid">
            <div className="info-cell">
              <div className="info-cell-label">Resource Group</div>
              <div className="info-cell-value" style={{ fontSize: 12, wordBreak: 'break-all' }}>{resource.resourceGroup}</div>
            </div>
            <div className="info-cell">
              <div className="info-cell-label">Resource ID</div>
              <div className="info-cell-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{resource.id}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(resource.id)}
                  title="Copy Resource ID"
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    fontSize: 10,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy
                </button>
              </div>
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
            {insight?.metrics && Object.keys(insight.metrics).length > 0 && Object.values(insight.metrics).some(v => v.length > 0) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(insight.metrics).map(([name, vals]) => (
                  vals.length > 0 ? (
                    <div key={name} className="metric-card">
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 2 }}>{name}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>
                          {(vals[vals.length - 1] ?? 0).toFixed(1)}%
                        </div>
                      </div>
                      <Sparkline data={vals} />
                    </div>
                  ) : null
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0', color: 'var(--text-3)', fontSize: 13 }}>
                No telemetry available for this resource type
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
                {insight?.recommendations && insight.recommendations.length > 0 ? (
                  insight.recommendations.map((rec, i) => (
                    <div key={i} style={{ padding: '8px 0', borderBottom: i < insight.recommendations.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: rec.category === 'delete' ? 'var(--danger-dim)' : rec.category === 'stop' ? 'var(--warning-dim)' : rec.category === 'rightsize' ? 'var(--accent-dim)' : 'var(--bg-surface)', color: rec.category === 'delete' ? 'var(--danger)' : rec.category === 'stop' ? 'var(--warning)' : 'var(--accent)' }}>
                          {rec.category.toUpperCase()}
                        </span>
                        {rec.estimatedSavings > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>${rec.estimatedSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 4 }}>{rec.action}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{rec.rationale}</div>
                    </div>
                  ))
                ) : (
                  <span style={{ color: 'var(--text-3)', fontSize: 13 }}>No recommendations available for this resource.</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DependencyGraphModal ─────────────────────────────────────────────────────

interface ResourceDependency {
  id: string;
  name: string;
  type: string;
  relationship: 'network' | 'storage' | 'parent' | 'reference' | 'identity';
  direction: 'inbound' | 'outbound';
  properties?: Record<string, any>;
}

interface DependencyGraph {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  dependencies: ResourceDependency[];
  dependents: ResourceDependency[];
  relationships: number;
  generatedAt: string;
}

// Generate SVG for dependency graph export
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

function DependencyGraphModal({ resource, onClose, onResourceClick, allResources }: { resource: AzureResource; onClose: () => void; onResourceClick?: (resource: AzureResource) => void; allResources: AzureResource[] }) {
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
      dep.relationship.toLowerCase().includes(query)
    );
  }, [graph, searchQuery]);

  const filteredDependents = useMemo(() => {
    if (!graph || !searchQuery.trim()) return graph?.dependents || [];
    const query = searchQuery.toLowerCase();
    return (graph.dependents || []).filter(dep =>
      dep.name.toLowerCase().includes(query) ||
      dep.type.toLowerCase().includes(query) ||
      dep.relationship.toLowerCase().includes(query)
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
                                fetch(`http://localhost:8080/api/resources?id=${encodeURIComponent(dep.id)}`)
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
                          <span style={{ fontSize: 20 }}>{getRelationshipIcon(dep.relationship)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{friendlyType(dep.type)}</div>
                          </div>
                          {depCost > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>${depCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          )}
                          <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: getRelationshipColor(dep.relationship) + '20', color: getRelationshipColor(dep.relationship) }}>
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
                                fetch(`http://localhost:8080/api/resources?id=${encodeURIComponent(dep.id)}`)
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
                          <span style={{ fontSize: 20 }}>{getRelationshipIcon(dep.relationship)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dep.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{friendlyType(dep.type)}</div>
                          </div>
                          {depCost > 0 && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>${depCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          )}
                          <span style={{ padding: '4px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700, background: getRelationshipColor(dep.relationship) + '20', color: getRelationshipColor(dep.relationship) }}>
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose, uniqueRegions, uniqueSubs, uniqueRGs, uniqueTypes, regionFilter, subFilter, rgFilter, typeFilter, showOrphanedOnly, showUnattachedDiskOnly, showUnassignedPIPOnly, showUnattachedNICOnly, showFavoritesOnly, setRegionFilter, setSubFilter, setRgFilter, setTypeFilter, setShowOrphanedOnly, setShowUnattachedDiskOnly, setShowUnassignedPIPOnly, setShowUnattachedNICOnly, setShowFavoritesOnly, setCurrentPage, collapsed, onToggleCollapse, favorites }: {
  open: boolean; onClose: () => void;
  uniqueRegions: string[]; uniqueSubs: string[]; uniqueRGs: string[]; uniqueTypes: string[];
  regionFilter: string[]; subFilter: string[]; rgFilter: string[]; typeFilter: string; showOrphanedOnly: boolean; showUnattachedDiskOnly: boolean; showUnassignedPIPOnly: boolean; showUnattachedNICOnly: boolean; showFavoritesOnly: boolean; favorites: Set<string>;
  setRegionFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setSubFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setRgFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setTypeFilter: React.Dispatch<React.SetStateAction<string>>;
  setShowOrphanedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUnattachedDiskOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUnassignedPIPOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUnattachedNICOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFavoritesOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (val: string) => {
    setter(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
    setCurrentPage(1);
  };

  const hasFilters = regionFilter.length || subFilter.length || rgFilter.length || typeFilter || showOrphanedOnly || showUnattachedDiskOnly || showUnassignedPIPOnly || showUnattachedNICOnly || showFavoritesOnly;

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
                  <button onClick={() => { setRegionFilter([]); setSubFilter([]); setRgFilter([]); setTypeFilter(''); setShowOrphanedOnly(false); setShowUnattachedDiskOnly(false); setShowUnassignedPIPOnly(false); setShowUnattachedNICOnly(false); setShowFavoritesOnly(false); setCurrentPage(1); }}
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
                    transition: 'all 0.2s ease', marginBottom: 8
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                  Orphaned Resources
                </button>
                <button
                  onClick={() => { setShowUnattachedDiskOnly((v: boolean) => !v); setCurrentPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                    border: showUnattachedDiskOnly ? '1px solid var(--warning)' : '1px solid var(--border)',
                    background: showUnattachedDiskOnly ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-surface)',
                    color: showUnattachedDiskOnly ? '#f59e0b' : 'var(--text-2)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left',
                    transition: 'all 0.2s ease', marginBottom: 8
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  Unattached Disks
                </button>
                <button
                  onClick={() => { setShowUnassignedPIPOnly((v: boolean) => !v); setCurrentPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                    border: showUnassignedPIPOnly ? '1px solid #0ea5e9' : '1px solid var(--border)',
                    background: showUnassignedPIPOnly ? 'rgba(14, 165, 233, 0.1)' : 'var(--bg-surface)',
                    color: showUnassignedPIPOnly ? '#0ea5e9' : 'var(--text-2)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left',
                    transition: 'all 0.2s ease', marginBottom: 8
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  Unassigned PIPs
                </button>
                <button
                  onClick={() => { setShowUnattachedNICOnly((v: boolean) => !v); setCurrentPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                    border: showUnattachedNICOnly ? '1px solid #f43f5e' : '1px solid var(--border)',
                    background: showUnattachedNICOnly ? 'rgba(244, 63, 94, 0.1)' : 'var(--bg-surface)',
                    color: showUnattachedNICOnly ? '#f43f5e' : 'var(--text-2)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left',
                    transition: 'all 0.2s ease', marginBottom: 8
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                    <path d="M6 21V23M18 21V23M8 7v2M12 7v2M16 7v2" />
                  </svg>
                  Unattached NICs
                </button>
                <button
                  onClick={() => { setShowFavoritesOnly(v => !v); setCurrentPage(1); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10,
                    border: showFavoritesOnly ? '1px solid #fbbf24' : '1px solid var(--border)',
                    background: showFavoritesOnly ? 'rgba(251, 191, 36, 0.15)' : 'var(--bg-surface)',
                    color: showFavoritesOnly ? '#fbbf24' : 'var(--text-2)',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'left',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={showFavoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  Favorites Only
                  {favorites.size > 0 && (
                    <span style={{
                      marginLeft: 'auto',
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: showFavoritesOnly ? 'rgba(251, 191, 36, 0.3)' : 'var(--bg-hover)',
                      fontSize: 11,
                      fontWeight: 700
                    }}>
                      {favorites.size}
                    </span>
                  )}
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataSubIds, setDataSubIds] = useState<Set<string>>(new Set());


  const [searchQuery, setSearchQuery] = useState(() => localStorage.getItem('cloudviz-search') || '');
  const [regionFilter, setRegionFilter] = useState<string[]>(() => {
    const saved = localStorage.getItem('cloudviz-regionFilter');
    return saved ? JSON.parse(saved) : [];
  });
  const [subFilter, setSubFilter] = useState<string[]>(() => {
    const saved = localStorage.getItem('cloudviz-subFilter');
    return saved ? JSON.parse(saved) : [];
  });
  const [rgFilter, setRgFilter] = useState<string[]>(() => {
    const saved = localStorage.getItem('cloudviz-rgFilter');
    return saved ? JSON.parse(saved) : [];
  });
  const [typeFilter, setTypeFilter] = useState(() => localStorage.getItem('cloudviz-typeFilter') || '');
  const [showOrphanedOnly, setShowOrphanedOnly] = useState(() => localStorage.getItem('cloudviz-orphaned') === 'true');
  const [showUnattachedDiskOnly, setShowUnattachedDiskOnly] = useState(() => localStorage.getItem('cloudviz-unattachedDisk') === 'true');
  const [showUnassignedPIPOnly, setShowUnassignedPIPOnly] = useState(() => localStorage.getItem('cloudviz-unassignedPIP') === 'true');
  const [showUnattachedNICOnly, setShowUnattachedNICOnly] = useState(() => localStorage.getItem('cloudviz-unattachedNIC') === 'true');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(() => localStorage.getItem('cloudviz-favoritesOnly') === 'true');
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('cloudviz-favorites');
    return new Set(saved ? JSON.parse(saved) : []);
  });
  const toggleFavorite = (resourceId: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      localStorage.setItem('cloudviz-favorites', JSON.stringify(Array.from(next)));
      return next;
    });
  };
  useEffect(() => { localStorage.setItem('cloudviz-favoritesOnly', String(showFavoritesOnly)); }, [showFavoritesOnly]);
  const [tagFilter, setTagFilter] = useState<{ key: string; value: string } | null>(() => {
    const saved = localStorage.getItem('cloudviz-tag-filter');
    return saved ? JSON.parse(saved) : null;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterPresets, setFilterPresets] = useState<Array<{name: string; regionFilter: string[]; subFilter: string[]; rgFilter: string[]; typeFilter: string; showOrphanedOnly: boolean; showUnattachedDiskOnly: boolean; showUnassignedPIPOnly: boolean; showUnattachedNICOnly: boolean}>>(() => {
    const saved = localStorage.getItem('cloudviz-filterPresets');
    return saved ? JSON.parse(saved) : [];
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('cloudviz-sidebarCollapsed') === 'true');
  const [dashboardOrder, setDashboardOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('cloudviz-dashOrder');
    return saved ? JSON.parse(saved) : ['insights', 'summary', 'sla', 'costComparison', 'chartsRow', 'costBySub', 'costByEnv', 'costTiers', 'dailyTrends', 'optimization', 'waste', 'forecast', 'commitment', 'topology', 'tagAnalysis', 'riRecommendations', 'costAnomalies'];
  });

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('cloudviz-theme');
    return saved ? saved === 'dark' : true;
  });

  const [selectedResource, setSelectedResource] = useState<AzureResource | null>(null);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelectedResources(new Set());
  const toggleSelection = (id: string, selected: boolean) => {
    setSelectedResources(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };
  const selectAll = (selected: boolean) => {
    if (selected) {
      setSelectedResources(new Set(resources.map(r => r.id)));
    } else {
      setSelectedResources(new Set());
    }
  };
  const bulkExportSelected = (ids: string[]) => {
    const selectedData = resources.filter(r => ids.includes(r.id));
    const headers = ['Name', 'Type', 'Location', 'Resource Group', 'Subscription', 'Cost', 'Status'];
    const rows = selectedData.map(r => [
      r.name,
      r.type,
      r.location,
      r.resourceGroup,
      r.subscriptionId,
      r.cost?.toString() || '0',
      r.status || 'Unknown'
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cloudviz-selected-${selectedData.length}-resources.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const [showDependencyGraph, setShowDependencyGraph] = useState(false);
  const [aiInsight, setAiInsight] = useState<{ metrics: MetricSeries; recommendations: Array<{category: string; action: string; estimatedSavings: number; savingsPercent: number; rationale: string; priority: number}> } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
    const saved = localStorage.getItem('cloudviz-sort');
    return saved ? JSON.parse(saved) : { key: null, direction: 'asc' };
  });
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = localStorage.getItem('cloudviz-currentPage');
    return saved ? parseInt(saved, 10) : 1;
  });
  const itemsPerPage = 25;

  const [activeTab, setActiveTab] = useState<'dashboard' | 'resources' | 'costs' | 'comparisons' | 'history'>(() => {
    return (localStorage.getItem('cloudviz-tab') as 'dashboard' | 'resources' | 'costs' | 'comparisons' | 'history') || 'dashboard';
  });
  const [selectedCost, setSelectedCost] = useState<CostPrediction | null>(null);
  const [costSearchQuery, setCostSearchQuery] = useState(() => localStorage.getItem('cloudviz-costSearchQuery') || '');
  const [costSortConfig, setCostSortConfig] = useState<{ key: keyof CostItem | null; direction: 'asc' | 'desc' }>(() => {
    const saved = localStorage.getItem('cloudviz-costSort');
    return saved ? JSON.parse(saved) : { key: null, direction: 'asc' };
  });
  useEffect(() => { localStorage.setItem('cloudviz-costSort', JSON.stringify(costSortConfig)); }, [costSortConfig]);
  const [dailyCosts, setDailyCosts] = useState<{ date: string; cost: number }[]>([]);
  const [costPeriod, setCostPeriod] = useState<'7' | '30' | '90'>(() => (localStorage.getItem('cloudviz-costPeriod') as '7' | '30' | '90') || '30');
  const [costPerDay, setCostPerDay] = useState<boolean>(() => localStorage.getItem('cloudviz-costPerDay') === 'true');
  useEffect(() => { localStorage.setItem('cloudviz-costPerDay', String(costPerDay)); }, [costPerDay]);
  // Helper to format cost based on per-day toggle
  const formatCost = (cost: number, period: 'month' | 'day' = costPerDay ? 'day' : 'month') => {
    const divisor = period === 'day' ? 30 : 1;
    const value = cost / divisor;
    return {
      value,
      formatted: value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      suffix: period === 'day' ? '/day' : '/mo'
    };
  };
  const [budgetLimit, setBudgetLimit] = useState<number>(() => {
    const saved = localStorage.getItem('cloudviz-budget');
    return saved ? parseFloat(saved) : 0;
  });
  const [webhookUrl, setWebhookUrl] = useState<string>(() => {
    return localStorage.getItem('cloudviz-webhook-url') || '';
  });
  const [trendZoom, setTrendZoom] = useState<{ left: number; right: number } | null>(null);
  const [isSelectingZoom, setIsSelectingZoom] = useState(false);
  const [zoomStart, setZoomStart] = useState<number | null>(null);
  const [zoomEnd, setZoomEnd] = useState<number | null>(null);
  useEffect(() => { localStorage.setItem('cloudviz-budget', String(budgetLimit)); }, [budgetLimit]);
  useEffect(() => { localStorage.setItem('cloudviz-webhook-url', webhookUrl); }, [webhookUrl]);
  useEffect(() => { localStorage.setItem('cloudviz-currentPage', String(currentPage)); }, [currentPage]);
  useEffect(() => { localStorage.setItem('cloudviz-costPeriod', costPeriod); }, [costPeriod]);
  useEffect(() => { localStorage.setItem('cloudviz-costSearchQuery', costSearchQuery); }, [costSearchQuery]);
  const [history, setHistory] = useState<ResourceChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [alertModal, setAlertModal] = useState<{open: boolean; title: string; message: string; icon: 'warning' | 'danger' | 'info'} | null>(null);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  const [commitmentSavings, setCommitmentSavings] = useState<any>(null);
  const [typeTrendData, setTypeTrendData] = useState<any>(null);
  const [envFilter, setEnvFilter] = useState(() => localStorage.getItem('cloudviz-envFilter') || '');
  useEffect(() => { localStorage.setItem('cloudviz-envFilter', envFilter); }, [envFilter]);
  const [piiMasking, setPiiMasking] = useState(() => localStorage.getItem('cloudviz-piiMasking') === 'true');
  useEffect(() => { localStorage.setItem('cloudviz-piiMasking', String(piiMasking)); }, [piiMasking]);
  const [wasteData, setWasteData] = useState<any>(null);
  const [periodComparison, setPeriodComparison] = useState<any>(null);
  const [forecastData, setForecastData] = useState<{actualCost: number; forecastCost: number; periodDays: number} | null>(null);
  const [anomalyData, setAnomalyData] = useState<{anomalies: Array<{subscriptionId: string; date: string; currentCost: number; previousCost: number; ratio: number; change: number}>; threshold: number; periodStart: string; periodEnd: string} | null>(null);
  const [enhancedAnomalyData, setEnhancedAnomalyData] = useState<{anomalies: Array<{subscriptionId: string; date: string; currentCost: number; previousCost: number; severity: string; score: number; methods: string[]; zscore?: number; madScore?: number; isolationScore?: number; seasonalScore?: number; trend?: string; dayOfWeek?: string}>; summary: {total: number; bySeverity: Record<string, number>; byMethod: Record<string, number>}; config: {zScoreThreshold: number; madThreshold: number; isolationThreshold: number; seasonalThreshold: number; methodsUsed: string[]}; periodStart: string; periodEnd: string} | null>(null);
  const [enhancedAnomalyLoading, setEnhancedAnomalyLoading] = useState(false);
  const [slaData, setSlaData] = useState<{periodDays: number; threshold: number; totalVMs: number; data: Array<{resourceId: string; name: string; resourceGroup: string; subscriptionId: string; location: string; uptimePercentage: number; downtimeHours: number; totalHours: number; status: string; hasMetrics: boolean}>} | null>(null);

  // Resource group comparison state
  const [rgComparison, setRgComparison] = useState<{
    rg1: { resourceGroup: string; subscriptionId: string; resourceCount: number; totalCost: number; averageCost: number; efficiencyScore: number; orphanedCount: number; typeBreakdown: Array<{type: string; count: number; cost: number; percent: number; costPercent: number}>; resourcesByType: Array<{type: string; count: number; totalCost: number; resources: Array<{id: string; name: string; type: string; location: string; cost: number; score: number; isOrphaned: boolean; optimization?: string}>}> };
    rg2: { resourceGroup: string; subscriptionId: string; resourceCount: number; totalCost: number; averageCost: number; efficiencyScore: number; orphanedCount: number; typeBreakdown: Array<{type: string; count: number; cost: number; percent: number; costPercent: number}>; resourcesByType: Array<{type: string; count: number; totalCost: number; resources: Array<{id: string; name: string; type: string; location: string; cost: number; score: number; isOrphaned: boolean; optimization?: string}>}> };
    comparison: { resourceCountDelta: number; costDelta: number; scoreDelta: number; winner: string };
  } | null>(null);
  const [rgCompareLoading, setRgCompareLoading] = useState(false);
  const [rgCompareOpen, setRgCompareOpen] = useState(false);
  const [rg1Selection, setRg1Selection] = useState<{rg: string; sub: string} | null>(null);
  const [rg2Selection, setRg2Selection] = useState<{rg: string; sub: string} | null>(null);
  const [rgExpandedTypes, setRgExpandedTypes] = useState<Set<string>>(new Set());

  // Subscription comparison state
  const [subComparison, setSubComparison] = useState<{
    sub1: { subscriptionId: string; resourceCount: number; resourceGroups: number; totalCost: number; averageCost: number; efficiencyScore: number; orphanedCount: number; typeBreakdown: Array<{type: string; count: number; cost: number; percent: number; costPercent: number}>; locationBreakdown: Array<{location: string; count: number; cost: number; percent: number; costPercent: number}>; resourcesByType: Array<{type: string; count: number; totalCost: number; resources: Array<{id: string; name: string; type: string; location: string; cost: number; score: number; isOrphaned: boolean; optimization?: string}>}> };
    sub2: { subscriptionId: string; resourceCount: number; resourceGroups: number; totalCost: number; averageCost: number; efficiencyScore: number; orphanedCount: number; typeBreakdown: Array<{type: string; count: number; cost: number; percent: number; costPercent: number}>; locationBreakdown: Array<{location: string; count: number; cost: number; percent: number; costPercent: number}>; resourcesByType: Array<{type: string; count: number; totalCost: number; resources: Array<{id: string; name: string; type: string; location: string; cost: number; score: number; isOrphaned: boolean; optimization?: string}>}> };
    comparison: { resourceCountDelta: number; costDelta: number; scoreDelta: number; rgDelta: number; winner: string };
  } | null>(null);
  const [subCompareLoading, setSubCompareLoading] = useState(false);
  const [subCompareOpen, setSubCompareOpen] = useState(false);
  const [sub1Selection, setSub1Selection] = useState<string | null>(null);
  const [sub2Selection, setSub2Selection] = useState<string | null>(null);
  const [subExpandedTypes, setSubExpandedTypes] = useState<Set<string>>(new Set());

  // Comparisons search state
  const [comparisonsSearchQuery, setComparisonsSearchQuery] = useState('');
  const [comparisonsSearchFocused, setComparisonsSearchFocused] = useState(false);
  const comparisonsSearchInputRef = useRef<HTMLInputElement>(null);

  const [allPossibleFilters, setAllPossibleFilters] = useState<{ subs: string[]; locations: string[]; rgs: string[]; types: string[] }>({
    subs: [], locations: [], rgs: [], types: [],
  });
  const [totalResources, setTotalResources] = useState(0);
  const [trueTotalResources, setTrueTotalResources] = useState(0);
  const [filteredTotalCost, setFilteredTotalCost] = useState(0);

  const debouncedSearch = useDebounce(searchQuery, 500);

  // Keyboard shortcuts state
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Define keyboard shortcuts
  const shortcuts: ShortcutConfig[] = useMemo(() => [
    {
      key: 'k',
      ctrl: true,
      description: 'Focus search',
      action: () => searchInputRef.current?.focus(),
    },
    {
      key: 'r',
      ctrl: true,
      description: 'Refresh data',
      action: () => window.location.reload(),
    },
    {
      key: 'e',
      ctrl: true,
      description: 'Export CSV',
      action: () => exportCSV(),
    },
    {
      key: 'd',
      ctrl: true,
      description: 'Toggle dark mode',
      action: () => setIsDarkMode(prev => !prev),
    },
    {
      key: '1',
      ctrl: true,
      description: 'Dashboard tab',
      action: () => setActiveTab('dashboard'),
    },
    {
      key: '2',
      ctrl: true,
      description: 'Resources tab',
      action: () => setActiveTab('resources'),
    },
    {
      key: '3',
      ctrl: true,
      description: 'Costs tab',
      action: () => setActiveTab('costs'),
    },
    {
      key: '4',
      ctrl: true,
      description: 'Comparisons tab',
      action: () => setActiveTab('comparisons'),
    },
    {
      key: '5',
      ctrl: true,
      description: 'History tab',
      action: () => setActiveTab('history'),
    },
    {
      key: 's',
      ctrl: true,
      description: 'Open settings',
      action: () => setShowSettings(true),
    },
    {
      key: '?',
      description: 'Show keyboard shortcuts',
      action: () => setShowShortcutsHelp(true),
    },
    {
      key: 'Escape',
      description: 'Close modals',
      action: () => {
        setShowShortcutsHelp(false);
        setShowSettings(false);
        setSidebarOpen(false);
        setSelectedResource(null);
        setSelectedCost(null);
      },
    },
  ], [setIsDarkMode, setActiveTab]);

  // Apply keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
    localStorage.setItem('cloudviz-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Persist filters and UI state
  useEffect(() => { localStorage.setItem('cloudviz-search', searchQuery); }, [searchQuery]);
  useEffect(() => { localStorage.setItem('cloudviz-regionFilter', JSON.stringify(regionFilter)); }, [regionFilter]);
  useEffect(() => { localStorage.setItem('cloudviz-subFilter', JSON.stringify(subFilter)); }, [subFilter]);
  useEffect(() => { localStorage.setItem('cloudviz-rgFilter', JSON.stringify(rgFilter)); }, [rgFilter]);
  useEffect(() => { localStorage.setItem('cloudviz-typeFilter', typeFilter); }, [typeFilter]);
  useEffect(() => { localStorage.setItem('cloudviz-orphaned', String(showOrphanedOnly)); }, [showOrphanedOnly]);
  useEffect(() => { localStorage.setItem('cloudviz-unattachedDisk', String(showUnattachedDiskOnly)); }, [showUnattachedDiskOnly]);
  useEffect(() => { localStorage.setItem('cloudviz-unassignedPIP', String(showUnassignedPIPOnly)); }, [showUnassignedPIPOnly]);
  useEffect(() => { localStorage.setItem('cloudviz-unattachedNIC', String(showUnattachedNICOnly)); }, [showUnattachedNICOnly]);
  useEffect(() => { localStorage.setItem('cloudviz-tag-filter', JSON.stringify(tagFilter)); }, [tagFilter]);
  useEffect(() => { localStorage.setItem('cloudviz-sort', JSON.stringify(sortConfig)); }, [sortConfig]);
  useEffect(() => { localStorage.setItem('cloudviz-tab', activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem('cloudviz-sidebarCollapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem('cloudviz-dashOrder', JSON.stringify(dashboardOrder)); }, [dashboardOrder]);

  // ── Dashboard panel renderers ──────────────────────────────────────────────
  const renderInsights = () => {
    // Determine severity level for styling
    const hasOrphaned = orphanedCount > 0;
    const hasWarnings = lowScoreCount > 0 || costAnomalies.length > 0;
    const severityLevel = hasOrphaned ? 'danger' : hasWarnings ? 'warning' : 'success';

    return (
    (lowScoreCount > 0 || orphanedCount > 0 || costAnomalies.length > 0) && (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: 'var(--bg-surface)',
        borderRadius: 12,
        border: '1px solid var(--border)'
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: severityLevel === 'danger' ? 'var(--danger-dim)' : 'var(--warning-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={severityLevel === 'danger' ? 'var(--danger)' : 'var(--warning)'} strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
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
    )
  );
  };

  const renderSummary = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
      <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => setActiveTab('costs')}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'var(--accent-dim)', borderRadius: '0 14px 0 100%' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(16 185 129 / 0.2)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-2)' }}>Total Cost</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, color: budgetStatus?.status === 'over' ? 'var(--danger)' : budgetStatus?.status === 'critical' ? 'var(--danger)' : budgetStatus?.status === 'warning' ? 'var(--warning)' : 'var(--accent)', letterSpacing: '-0.03em', lineHeight: 1 }}>
          {costsLoading ? <span style={{ opacity: 0.5 }}>—</span> : (() => { const c = formatCost(totalCostsSum); return `$${c.formatted}${c.suffix}`; })()}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{costsLoading ? 'Loading...' : `${costs.length} cost entries`}</span>
          {budgetStatus && !costsLoading && <span style={{ padding: '2px 8px', borderRadius: 12, background: budgetStatus.color === 'var(--accent)' ? 'var(--accent-dim)' : budgetStatus.color === 'var(--warning)' ? 'var(--warning-dim)' : 'var(--danger-dim)', color: budgetStatus.color, fontSize: 10, fontWeight: 600 }}>{budgetStatus.message}</span>}
        </div>
        {!costsLoading && periodComparison && (
          <div style={{ fontSize: 11, color: periodComparison.delta?.percent > 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            {periodComparison.delta?.percent > 0 ? '↑' : '↓'} {Math.abs(periodComparison.delta?.percent || 0).toFixed(1)}% vs prior {costPeriod}d period
            <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
              ({periodComparison.delta?.absolute > 0 ? '+' : ''}${periodComparison.delta?.absolute?.toLocaleString(undefined, { maximumFractionDigits: 0 })})
            </span>
          </div>
        )}
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
        <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-1)', letterSpacing: '-0.03em', lineHeight: 1 }}>{trueTotalResources.toLocaleString()}</div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{trueTotalResources === 1 ? 'resource' : 'resources'}</div>
      </div>

      <div className="card card-animate card-interactive" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setCurrentPage(1); }}>
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
        <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: 'var(--accent-dim)', borderRadius: '0 14px 0 100%' }} />
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
  );

  const renderSLA = () => (
    slaData && slaData.data.length > 0 && (
      <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139 92 246 / 0.3)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>VM Uptime (SLA)</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Last {slaData.periodDays} days · {slaData.totalVMs} VMs</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slaData.data.slice(0, 5).map((vm, i) => {
            const color = vm.status === 'healthy' ? '#10b981' : vm.status === 'warning' ? '#f59e0b' : '#f43f5e';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${color}40`, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color }}>{vm.uptimePercentage.toFixed(1)}%</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{vm.resourceGroup}</span>
                    <span>·</span>
                    <span>{vm.downtimeHours > 0 ? `${vm.downtimeHours.toFixed(1)}h down` : 'No downtime'}</span>
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: `${color}15`, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {vm.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    )
  );

  const renderCostComparison = () => (
    costComparison && (
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
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setActiveTab('resources'); const rg = c.resourceGroup; if (rg) { setRgFilter([rg]); } else { setRgFilter([]); } setCurrentPage(1); }} onMouseEnter={e => { const s = e.currentTarget.style; s.borderColor='var(--border-strong)'; s.transform='translateX(4px)'; }} onMouseLeave={e => { const s = e.currentTarget.style; s.borderColor='var(--border)'; s.transform='translateX(0)'; }}>
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
    )
  );

  const renderRGComparison = () => (
    <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M9 17V7m0 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10V7m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2" /></svg>
          </div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Resource Group Comparison</span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Compare two resource groups side-by-side</span>
          </div>
        </div>
        <button
          onClick={() => setRgCompareOpen(true)}
          style={{ padding: '8px 16px', borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', color: 'white', border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4" /></svg>
          Compare Groups
        </button>
      </div>

      {rgComparison ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'stretch' }}>
            {/* RG1 */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>1</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rgComparison.rg1.resourceGroup}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace' }}>{rgComparison.rg1.subscriptionId.slice(0, 8)}...</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Resources</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{rgComparison.rg1.resourceCount}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Cost</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>${rgComparison.rg1.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Efficiency</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: rgComparison.rg1.efficiencyScore >= 80 ? 'var(--accent)' : rgComparison.rg1.efficiencyScore >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{rgComparison.rg1.efficiencyScore}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Orphaned</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: rgComparison.rg1.orphanedCount > 0 ? 'var(--danger)' : 'var(--accent)' }}>{rgComparison.rg1.orphanedCount}</div>
                </div>
              </div>
            </div>

            {/* VS indicator */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>VS</div>
              {rgComparison.comparison.winner !== 'tie' && (
                <div style={{ padding: '6px 12px', borderRadius: 12, background: rgComparison.comparison.winner === 'rg1' ? 'var(--blue-dim)' : 'var(--accent-dim)', fontSize: 10, fontWeight: 700, color: rgComparison.comparison.winner === 'rg1' ? 'var(--blue)' : 'var(--accent)' }}>
                  {rgComparison.comparison.winner === 'rg1' ? 'Winner' : 'Runner-up'}
                </div>
              )}
            </div>

            {/* RG2 */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>2</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rgComparison.rg2.resourceGroup}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'monospace' }}>{rgComparison.rg2.subscriptionId.slice(0, 8)}...</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Resources</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{rgComparison.rg2.resourceCount}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Cost</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>${rgComparison.rg2.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Efficiency</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: rgComparison.rg2.efficiencyScore >= 80 ? 'var(--accent)' : rgComparison.rg2.efficiencyScore >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{rgComparison.rg2.efficiencyScore}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Orphaned</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: rgComparison.rg2.orphanedCount > 0 ? 'var(--danger)' : 'var(--accent)' }}>{rgComparison.rg2.orphanedCount}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Side-by-Side Resource Tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* RG1 Resource Table */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: 'var(--blue-dim)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)' }}>{rgComparison.rg1.resourceGroup}</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 8 }}>{rgComparison.rg1.resourceCount} resources</span>
              </div>
              <div style={{ maxHeight: 500, overflow: 'auto' }}>
                {rgComparison.rg1.resourcesByType?.map((typeGroup: any) => (
                  <div key={typeGroup.type} style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                      onClick={() => {
                        const newSet = new Set(rgExpandedTypes);
                        if (newSet.has(typeGroup.type)) {
                          newSet.delete(typeGroup.type);
                        } else {
                          newSet.add(typeGroup.type);
                        }
                        setRgExpandedTypes(newSet);
                      }}
                      style={{ width: '100%', padding: '10px 16px', background: 'var(--bg-card)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: rgExpandedTypes.has(typeGroup.type) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-3)' }}><path d="M9 18l6-6-6-6" /></svg>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{friendlyType(typeGroup.type)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 10 }}>{typeGroup.count}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>${typeGroup.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </button>
                    {rgExpandedTypes.has(typeGroup.type) && (
                      <div style={{ background: 'var(--bg-surface)' }}>
                        {typeGroup.resources.map((res: any) => (
                          <div key={res.id} style={{ padding: '10px 16px 10px 40px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{res.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{res.location} {res.isOrphaned && <span style={{ color: 'var(--danger)' }}>(orphaned)</span>}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'monospace' }}>${res.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div style={{ fontSize: 10, color: res.score >= 80 ? 'var(--accent)' : res.score >= 50 ? 'var(--warning)' : 'var(--danger)' }}>Score: {res.score}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* RG2 Resource Table */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: 'var(--accent-dim)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{rgComparison.rg2.resourceGroup}</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 8 }}>{rgComparison.rg2.resourceCount} resources</span>
              </div>
              <div style={{ maxHeight: 500, overflow: 'auto' }}>
                {rgComparison.rg2.resourcesByType?.map((typeGroup: any) => (
                  <div key={typeGroup.type} style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                      onClick={() => {
                        const newSet = new Set(rgExpandedTypes);
                        if (newSet.has(typeGroup.type)) {
                          newSet.delete(typeGroup.type);
                        } else {
                          newSet.add(typeGroup.type);
                        }
                        setRgExpandedTypes(newSet);
                      }}
                      style={{ width: '100%', padding: '10px 16px', background: 'var(--bg-card)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: rgExpandedTypes.has(typeGroup.type) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-3)' }}><path d="M9 18l6-6-6-6" /></svg>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{friendlyType(typeGroup.type)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 10 }}>{typeGroup.count}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>${typeGroup.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </button>
                    {rgExpandedTypes.has(typeGroup.type) && (
                      <div style={{ background: 'var(--bg-surface)' }}>
                        {typeGroup.resources.map((res: any) => (
                          <div key={res.id} style={{ padding: '10px 16px 10px 40px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{res.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{res.location} {res.isOrphaned && <span style={{ color: 'var(--danger)' }}>(orphaned)</span>}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'monospace' }}>${res.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div style={{ fontSize: 10, color: res.score >= 80 ? 'var(--accent)' : res.score >= 50 ? 'var(--warning)' : 'var(--danger)' }}>Score: {res.score}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.5 }}><path d="M9 17V7m0 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10V7m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2" /></svg>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No comparison selected</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Click "Compare Groups" to analyze two resource groups</div>
        </div>
      )}

      {/* Comparison Modal */}
      {rgCompareOpen && (
        <Portal>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRgCompareOpen(false)}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Compare Resource Groups</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Select two resource groups to compare</div>
                </div>
                <button onClick={() => setRgCompareOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* RG1 Selection */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Resource Group 1</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={rg1Selection?.rg || ''}
                      onChange={(e) => {
                        const rg = e.target.value;
                        const matchingResource = resources.find(r => r.resourceGroup === rg);
                        const sub = matchingResource?.subscriptionId || '';
                        setRg1Selection(rg ? { rg, sub } : null);
                      }}
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 13 }}
                    >
                      <option value="">Select resource group...</option>
                      {allPossibleFilters.rgs.map(rg => (
                        <option key={rg} value={rg}>{rg}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* RG2 Selection */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Resource Group 2</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={rg2Selection?.rg || ''}
                      onChange={(e) => {
                        const rg = e.target.value;
                        const matchingResource = resources.find(r => r.resourceGroup === rg);
                        const sub = matchingResource?.subscriptionId || '';
                        setRg2Selection(rg ? { rg, sub } : null);
                      }}
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 13 }}
                    >
                      <option value="">Select resource group...</option>
                      {allPossibleFilters.rgs.map(rg => (
                        <option key={rg} value={rg}>{rg}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button
                    onClick={async () => {
                      if (!rg1Selection || !rg2Selection) return;
                      setRgCompareLoading(true);
                      try {
                        const params = new URLSearchParams({
                          rg1: rg1Selection.rg,
                          rg2: rg2Selection.rg,
                          sub1: rg1Selection.sub,
                          sub2: rg2Selection.sub,
                        });
                        const res = await fetch(`/api/resource-groups/comparison?${params}`);
                        const data = await res.json();
                        if (data.rg1 && data.rg2) {
                          setRgComparison(data);
                          setRgCompareOpen(false);
                        }
                      } catch (err) {
                        console.error('Failed to fetch RG comparison:', err);
                      } finally {
                        setRgCompareLoading(false);
                      }
                    }}
                    disabled={!rg1Selection || !rg2Selection || rgCompareLoading}
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: (!rg1Selection || !rg2Selection) ? 'var(--border)' : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      color: 'white',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: (!rg1Selection || !rg2Selection) ? 'not-allowed' : 'pointer',
                      opacity: (!rg1Selection || !rg2Selection) ? 0.6 : 1,
                    }}
                  >
                    {rgCompareLoading ? 'Loading...' : 'Compare'}
                  </button>
                  <button
                    onClick={() => { setRg1Selection(null); setRg2Selection(null); setRgCompareOpen(false); }}
                    style={{ padding: '12px 20px', borderRadius: 8, background: 'var(--bg-surface)', color: 'var(--text-1)', border: '1px solid var(--border)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );

  const renderSubComparison = () => (
    <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(6, 182, 212, 0.3)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
          </div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Subscription Comparison</span>
            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Compare two subscriptions side-by-side</span>
          </div>
        </div>
        <button
          onClick={() => setSubCompareOpen(true)}
          style={{ padding: '8px 16px', borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', color: 'white', border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4" /></svg>
          Compare Subscriptions
        </button>
      </div>

      {subComparison ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'stretch' }}>
            {/* Sub1 */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>1</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{subComparison.sub1.subscriptionId}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Resources</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{subComparison.sub1.resourceCount.toLocaleString()}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Cost</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>${subComparison.sub1.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Efficiency</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: subComparison.sub1.efficiencyScore >= 80 ? 'var(--accent)' : subComparison.sub1.efficiencyScore >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{subComparison.sub1.efficiencyScore}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>R Groups</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{subComparison.sub1.resourceGroups}</div>
                </div>
              </div>
            </div>

            {/* VS indicator */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>VS</div>
              {subComparison.comparison.winner !== 'tie' && (
                <div style={{ padding: '6px 12px', borderRadius: 12, background: subComparison.comparison.winner === 'sub1' ? 'var(--blue-dim)' : 'var(--accent-dim)', fontSize: 10, fontWeight: 700, color: subComparison.comparison.winner === 'sub1' ? 'var(--blue)' : 'var(--accent)' }}>
                  {subComparison.comparison.winner === 'sub1' ? 'Winner' : 'Runner-up'}
                </div>
              )}
            </div>

            {/* Sub2 */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>2</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{subComparison.sub2.subscriptionId}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Resources</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{subComparison.sub2.resourceCount.toLocaleString()}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Cost</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>${subComparison.sub2.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>Efficiency</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: subComparison.sub2.efficiencyScore >= 80 ? 'var(--accent)' : subComparison.sub2.efficiencyScore >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{subComparison.sub2.efficiencyScore}</div>
                </div>
                <div style={{ padding: 10, background: 'var(--bg-card)', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>R Groups</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{subComparison.sub2.resourceGroups}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Side-by-Side Resource Tables */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Sub1 Resource Table */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: 'var(--blue-dim)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)' }}>{subComparison.sub1.subscriptionId.slice(0, 20)}...</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 8 }}>{subComparison.sub1.resourceCount} resources</span>
              </div>
              <div style={{ maxHeight: 500, overflow: 'auto' }}>
                {subComparison.sub1.resourcesByType?.map((typeGroup: any) => (
                  <div key={typeGroup.type} style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                      onClick={() => {
                        const newSet = new Set(subExpandedTypes);
                        if (newSet.has(typeGroup.type)) {
                          newSet.delete(typeGroup.type);
                        } else {
                          newSet.add(typeGroup.type);
                        }
                        setSubExpandedTypes(newSet);
                      }}
                      style={{ width: '100%', padding: '10px 16px', background: 'var(--bg-card)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: subExpandedTypes.has(typeGroup.type) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-3)' }}><path d="M9 18l6-6-6-6" /></svg>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{friendlyType(typeGroup.type)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 10 }}>{typeGroup.count}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>${typeGroup.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </button>
                    {subExpandedTypes.has(typeGroup.type) && (
                      <div style={{ background: 'var(--bg-surface)' }}>
                        {typeGroup.resources.map((res: any) => (
                          <div key={res.id} style={{ padding: '10px 16px 10px 40px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{res.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{res.location} {res.isOrphaned && <span style={{ color: 'var(--danger)' }}>(orphaned)</span>}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'monospace' }}>${res.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div style={{ fontSize: 10, color: res.score >= 80 ? 'var(--accent)' : res.score >= 50 ? 'var(--warning)' : 'var(--danger)' }}>Score: {res.score}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Sub2 Resource Table */}
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', background: 'var(--accent-dim)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{subComparison.sub2.subscriptionId.slice(0, 20)}...</span>
                <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 8 }}>{subComparison.sub2.resourceCount} resources</span>
              </div>
              <div style={{ maxHeight: 500, overflow: 'auto' }}>
                {subComparison.sub2.resourcesByType?.map((typeGroup: any) => (
                  <div key={typeGroup.type} style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                      onClick={() => {
                        const newSet = new Set(subExpandedTypes);
                        if (newSet.has(typeGroup.type)) {
                          newSet.delete(typeGroup.type);
                        } else {
                          newSet.add(typeGroup.type);
                        }
                        setSubExpandedTypes(newSet);
                      }}
                      style={{ width: '100%', padding: '10px 16px', background: 'var(--bg-card)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: subExpandedTypes.has(typeGroup.type) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-3)' }}><path d="M9 18l6-6-6-6" /></svg>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{friendlyType(typeGroup.type)}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 10 }}>{typeGroup.count}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>${typeGroup.totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </button>
                    {subExpandedTypes.has(typeGroup.type) && (
                      <div style={{ background: 'var(--bg-surface)' }}>
                        {typeGroup.resources.map((res: any) => (
                          <div key={res.id} style={{ padding: '10px 16px 10px 40px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{res.name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{res.location} {res.isOrphaned && <span style={{ color: 'var(--danger)' }}>(orphaned)</span>}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'monospace' }}>${res.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div style={{ fontSize: 10, color: res.score >= 80 ? 'var(--accent)' : res.score >= 50 ? 'var(--warning)' : 'var(--danger)' }}>Score: {res.score}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.5 }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No comparison selected</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Click "Compare Subscriptions" to analyze two subscriptions</div>
        </div>
      )}

      {/* Comparison Modal */}
      {subCompareOpen && (
        <Portal>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSubCompareOpen(false)}>
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 500, maxHeight: '80vh', overflow: 'auto', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Compare Subscriptions</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Select two subscriptions to compare</div>
                </div>
                <button onClick={() => setSubCompareOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Sub1 Selection */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Subscription 1</div>
                  <select
                    value={sub1Selection || ''}
                    onChange={(e) => setSub1Selection(e.target.value || null)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'monospace' }}
                  >
                    <option value="">Select subscription...</option>
                    {allPossibleFilters.subs.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>

                {/* Sub2 Selection */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Subscription 2</div>
                  <select
                    value={sub2Selection || ''}
                    onChange={(e) => setSub2Selection(e.target.value || null)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'monospace' }}
                  >
                    <option value="">Select subscription...</option>
                    {allPossibleFilters.subs.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button
                    onClick={async () => {
                      if (!sub1Selection || !sub2Selection) return;
                      setSubCompareLoading(true);
                      try {
                        const params = new URLSearchParams({
                          sub1: sub1Selection,
                          sub2: sub2Selection,
                        });
                        const res = await fetch(`/api/subscriptions/comparison?${params}`);
                        const data = await res.json();
                        if (data.sub1 && data.sub2) {
                          setSubComparison(data);
                          setSubCompareOpen(false);
                        }
                      } catch (err) {
                        console.error('Failed to fetch subscription comparison:', err);
                      } finally {
                        setSubCompareLoading(false);
                      }
                    }}
                    disabled={!sub1Selection || !sub2Selection || subCompareLoading}
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      borderRadius: 8,
                      background: (!sub1Selection || !sub2Selection) ? 'var(--border)' : 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                      color: 'white',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: (!sub1Selection || !sub2Selection) ? 'not-allowed' : 'pointer',
                      opacity: (!sub1Selection || !sub2Selection) ? 0.6 : 1,
                    }}
                  >
                    {subCompareLoading ? 'Loading...' : 'Compare'}
                  </button>
                  <button
                    onClick={() => { setSub1Selection(null); setSub2Selection(null); setSubCompareOpen(false); }}
                    style={{ padding: '12px 20px', borderRadius: 8, background: 'var(--bg-surface)', color: 'var(--text-1)', border: '1px solid var(--border)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );

  const renderChartsRow = () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
      {/* Cost by Region (PieChart) */}
      <div className="card chart-card-clickable" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, var(--blue-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--blue) 0%, #2563eb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Cost by Region</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{costsByRegion.length} regions</span>
            </div>
          </div>
          <span className="chart-hint-badge" style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue)', background: 'var(--blue-dim)', padding: '4px 10px', borderRadius: 12, border: '1px solid var(--blue-border)' }}>Interactive</span>
        </div>
        {costsByRegion.length > 0 ? (
          <>
            <div style={{ position: 'relative' }}>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={costsByRegion}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    innerRadius={35}
                    paddingAngle={2}
                    onClick={(data: { name?: string; payload?: { name?: string } }) => { const name = data?.name || data?.payload?.name; if (name) { setActiveTab('resources'); setRegionFilter([String(name)]); setCurrentPage(1); } }}
                    style={{ cursor: 'pointer' }}
                  >
                    {costsByRegion.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--bg-card)" strokeWidth={2} style={{ cursor: 'pointer', transition: 'all 0.2s ease', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }} />)}
                  </Pie>
                   <Tooltip
                     formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Cost']}
                     labelStyle={{ color: 'var(--text-1)', fontWeight: 800, fontSize: 14, marginBottom: 4 }}
                     itemStyle={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}
                     contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '12px 16px' }}
                   />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-1)' }}>${(totalCostsSum / 1000).toFixed(0)}k</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 500 }}>TOTAL</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {costsByRegion.slice(0, 6).map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)' }} onClick={() => { setActiveTab('resources'); setRegionFilter([item.name]); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--blue)'; e.currentTarget.style.background='var(--blue-dim)'; e.currentTarget.style.transform='translateY(-1px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-surface)'; e.currentTarget.style.transform='translateY(0)'; }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)' }}>{item.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>${(item.value / 1000).toFixed(1)}k</span>
                </div>
              ))}
            </div>
          </>
        ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} message="No cost data available" />}
      </div>

      {/* Cost by Resource Type */}
      <div className="card chart-card-clickable" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Cost by Resource Type</span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', background: 'var(--bg-surface)', padding: '3px 8px', borderRadius: 4 }}>Click bars</span>
        </div>
        {costsByType.length > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {costsByType.slice(0, 3).map((item, i) => (
                <div key={i} style={{ flex: 1, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); setTypeFilter(item.raw); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor=COLORS[i % COLORS.length]; e.currentTarget.style.transform='translateY(-2px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateY(0)'; }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, width: 4, bottom: 0, background: COLORS[i % COLORS.length] }} />
                  <div style={{ paddingLeft: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', marginBottom: 2 }}>#{i + 1}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>${(item.value / 1000).toFixed(1)}k</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ height: Math.max(120, costsByType.length * 24) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costsByType} layout="vertical" margin={{ left: 60, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-2)', fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 10 }} width={80} axisLine={false} tickLine={false} />
                   <Tooltip
                     formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Cost']}
                     labelStyle={{ color: 'var(--text-1)', fontWeight: 800, fontSize: 14, marginBottom: 4 }}
                     itemStyle={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}
                     contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '12px 16px' }}
                     cursor={{ fill: 'var(--accent-dim)' }}
                   />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={(data: { raw?: string; payload?: { raw?: string } }) => { const raw = data?.raw || data?.payload?.raw; if (raw) { setActiveTab('resources'); setTypeFilter(raw); setCurrentPage(1); } }} style={{ cursor: 'pointer', transition: 'all 0.2s ease' }}>
                    {costsByType.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>} message="No cost data available" />}
      </div>

      {/* Cost by Type Trend (Stacked Area) */}
      {typeTrendData?.dates && typeTrendData.types && typeTrendData.types.length > 0 && (
        <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, rgba(99 102 241 / 0.12) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(99 102 241 / 0.3)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 3v18h18" /><path d="M7 12l4-4 4 4 5-6" /></svg>
              </div>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Cost by Type Trend</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{typeTrendData.types.length} types · {costPeriod} day period</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['7', '30', '90'] as const).map(p => (
                <button key={p} onClick={() => setCostPeriod(p)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: '1px solid', borderColor: costPeriod === p ? 'var(--accent)' : 'var(--border)', borderRadius: 6, background: costPeriod === p ? 'var(--accent)' : 'transparent', color: costPeriod === p ? 'white' : 'var(--text-2)', cursor: 'pointer' }}>
                  {p}d
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {typeTrendData.types.slice(0, 8).map((t: string, i: number) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-2)' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={typeTrendData.dates} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-3)', fontSize: 9 }} tickFormatter={v => typeof v === 'string' ? v.slice(5) : ''} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }: any) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const items = payload
                    .filter((p: any) => p.value > 0)
                    .map((p: any) => ({
                      name: p.dataKey,
                      value: p.value,
                      color: p.color,
                    }))
                    .sort((a: any, b: any) => b.value - a.value);
                  const total = items.reduce((s: number, item: any) => s + item.value, 0);
                  return (
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 12, minWidth: 220 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                        {label}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                        {items.slice(0, 8).map((item: any, idx: number) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: '#94a3b8', textTransform: 'capitalize' }}>{item.name}</span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>
                              ${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>Total</span>
                        <span style={{ fontSize: 12, fontWeight: 900, color: '#34d399' }}>
                          ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              {typeTrendData.types.slice(0, 8).map((t: string, i: number) => (
                <Area key={t} type="monotone" dataKey={t} stackId="1" stroke="transparent" fill={COLORS[i % COLORS.length]} fillOpacity={1} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top Spenders */}
      <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: 'radial-gradient(circle at top right, var(--danger-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f43f5e', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(244, 63 94, 0.3)' }}>
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
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)', position: 'relative' }} onClick={() => { setActiveTab('resources'); const rg = c.resourceGroup; if (rg) { setRgFilter([rg]); } else { setRgFilter([]); } setCurrentPage(1); }} onMouseEnter={e => { const s = e.currentTarget.style; s.borderColor = COLORS[i % COLORS.length]; s.transform = 'translateX(4px)'; }} onMouseLeave={e => { const s = e.currentTarget.style; s.borderColor = 'var(--border)'; s.transform = 'translateX(0)'; }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0, boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>{i + 1}</div>
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
    </div>
  );

  // ── DraggablePanel wrapper ────────────────────────────────────────────────────
  const [dndDragId, setDndDragId] = useState<string | null>(null);
  const [dndOverId, setDndOverId] = useState<string | null>(null);

  const handleDragStart = (id: string) => setDndDragId(id);
  const handleDragOver = (e: React.DragEvent, id: string) => { e.preventDefault(); setDndOverId(id); };
  const handleDrop = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dndDragId && dndDragId !== id) {
      setDashboardOrder(prev => {
        const next = [...prev];
        const from = next.indexOf(dndDragId);
        const to = next.indexOf(id);
        next.splice(from, 1);
        next.splice(to, 0, dndDragId);
        return next;
      });
    }
    setDndDragId(null);
    setDndOverId(null);
  };
  const handleDragEnd = () => { setDndDragId(null); setDndOverId(null); };

  const PanelWrapper = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <div
      draggable
      onDragStart={() => handleDragStart(id)}
      onDragOver={(e) => handleDragOver(e, id)}
      onDrop={(e) => handleDrop(e, id)}
      onDragEnd={handleDragEnd}
      className="panel-drag"
      style={{
        opacity: dndDragId && dndDragId !== id ? 0.5 : 1,
        border: dndOverId === id ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 16,
        transition: 'opacity 0.2s, border-color 0.15s',
        cursor: 'grab',
        overflow: 'auto',
      }}
    >
      <div className="panel-drag-handle" style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, cursor: 'grab', opacity: 0, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9l4-4 4 4M5 15l4 4 4-4"/></svg>
        Drag
      </div>
      {children}
    </div>
  );

  const dashboardPanels: { id: string; render: () => React.ReactNode }[] = [
    { id: 'insights', render: renderInsights },
    { id: 'summary', render: renderSummary },
    { id: 'sla', render: renderSLA },
    { id: 'costComparison', render: renderCostComparison },
    { id: 'chartsRow', render: renderChartsRow },
    { id: 'costBySub', render: () => (
      <div className="card chart-card-clickable" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: 'var(--accent-dim)', borderRadius: '0 14px 0 100%' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px var(--accent-dim)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Cost by Subscription</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{costsBySubscription.length} subscriptions</span>
            </div>
          </div>
          <span className="chart-hint-badge">Interactive</span>
        </div>
        {costsBySubscription.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {costsBySubscription.slice(0, 5).map((sub, i) => {
              const maxVal = costsBySubscription[0]?.value || 1;
              const percentage = maxVal > 0 ? (sub.value / maxVal) * 100 : 0;
              const color = COLORS[i % COLORS.length];
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }} onClick={() => { const fullId = uniqueSubs.find(s => s.startsWith(sub.name)); if (fullId) { setActiveTab('resources'); setSubFilter([fullId]); setCurrentPage(1); }}} onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${color}20`; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percentage}%`, background: `${color}15`, transition: 'width 0.5s ease' }} />
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)', minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', zIndex: 1 }}>{sub.name}</div>
                  <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', zIndex: 1 }}>
                    <div style={{ height: '100%', width: `${percentage}%`, background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
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
    ) },
    { id: 'costByEnv', render: () => (
      <>
        {(loading || (costsByEnvironment.length > 0 && costsByEnvironment.some(e => e.name !== 'Untagged'))) && (
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
              <span className="chart-hint-badge" style={{ fontSize: 10, fontWeight: 600, color: '#ec4899', background: 'rgba(236 72 153 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(236 72 153 / 0.2)' }}>Interactive</span>
            </div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', minHeight: 180 }}>
              <div style={{ position: 'relative', width: '40%', height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costsByEnvironment.filter(e => e.name !== 'Untagged' && e.value > 0)}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      innerRadius={45}
                      paddingAngle={3}
                      style={{ cursor: 'pointer' }}
                      onClick={(data: any) => { if (data?.name) { setActiveTab('resources'); setTagFilter({ key: 'Environment', value: data.name }); setCurrentPage(1); } }}
                    >
                      {costsByEnvironment.filter(e => e.name !== 'Untagged' && e.value > 0).map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--bg-card)" strokeWidth={2} style={{ cursor: 'pointer', outline: 'none' }} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Cost']}
                      labelStyle={{ color: 'var(--text-1)', fontWeight: 800, fontSize: 14, marginBottom: 4 }}
                      itemStyle={{ color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}
                      contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '12px 16px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>
                    ${(costsByEnvironment.filter(e => e.name !== 'Untagged').reduce((acc, curr) => acc + curr.value, 0) / 1000).toFixed(0)}k
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.05em' }}>TAGGED</div>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                {costsByEnvironment.filter(e => e.name !== 'Untagged' && e.value > 0).slice(0, 8).map((env, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-surface)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s ease', border: '1px solid var(--border)' }} onClick={() => { setActiveTab('resources'); setTagFilter({ key: 'Environment', value: env.name }); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor=COLORS[i % COLORS.length]; e.currentTarget.style.transform='translateX(4px)'; e.currentTarget.style.background='var(--bg-hover)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; e.currentTarget.style.background='var(--bg-surface)'; }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>${(env.value / 1000).toFixed(1)}k</span>
                  </div>
                ))}
                {costsByEnvironment.filter(e => e.name !== 'Untagged' && e.value > 0).length > 8 && (
                  <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 10, padding: '4px 0' }}>
                    +{costsByEnvironment.filter(e => e.name !== 'Untagged' && e.value > 0).length - 8} more environments
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    ) },
    { id: 'costTiers', render: () => (
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
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${percentage}%`, background: `${group.color}15`, transition: 'width 0.5s ease' }} />
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
    ) },
    { id: 'dailyTrends', render: () => (
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
          <span className="chart-hint-badge" style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6 182 212 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(6 182 212 / 0.2)' }}>Interactive</span>
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
                    <div style={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, background: 'var(--accent-dim)', borderRadius: '0 8px 0 100%' }} />
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
                    <div style={{ position: 'absolute', top: 0, right: 0, width: 40, height: 40, background: trend >= 0 ? 'var(--danger-dim)' : 'var(--accent-dim)', borderRadius: '0 8px 0 100%' }} />
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
          <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {(['7', '30', '90'] as const).map(p => (
                <button key={p} onClick={() => setCostPeriod(p)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: '1px solid', borderColor: costPeriod === p ? 'var(--accent)' : 'var(--border)', borderRadius: 6, background: costPeriod === p ? 'var(--accent)' : 'transparent', color: costPeriod === p ? 'white' : 'var(--text-2)', cursor: 'pointer' }}>
                  {p}d
                </button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={180}>
            <LineChart data={dailyCosts} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} onMouseDown={(e: any) => { if (e && e.activeLabelIndex !== undefined) { setIsSelectingZoom(true); setZoomStart(e.activeLabelIndex); setZoomEnd(null); } }} onMouseMove={(e: any) => { if (isSelectingZoom && e && e.activeLabelIndex !== undefined) setZoomEnd(e.activeLabelIndex); }} onMouseUp={() => { if (isSelectingZoom && zoomStart !== null && zoomEnd !== null && zoomStart !== zoomEnd) { const left = Math.min(zoomStart, zoomEnd); const right = Math.max(zoomStart, zoomEnd); setTrendZoom({ left, right }); } setIsSelectingZoom(false); setZoomStart(null); setZoomEnd(null); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-3)', fontSize: 9 }} tickFormatter={v => v ? v.slice(5) : ''} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-3)', fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: unknown) => `$${Number(v).toLocaleString()}`} labelFormatter={(l: unknown) => String(l)} contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-lg)' }} />
              <Area type="monotone" dataKey="cost" stroke="transparent" fill="var(--accent)" fillOpacity={1} />
              <Line type="monotone" dataKey="cost" stroke="var(--accent)" strokeWidth={2.5} dot={false} activeDot={{ r: 6, fill: 'var(--accent)', stroke: 'var(--bg-card)', strokeWidth: 3, style: { filter: 'drop-shadow(0 2px 6px rgba(16 185 129 / 0.4))' } }} />
              {isSelectingZoom && zoomStart !== null && zoomEnd !== null && <ReferenceArea x1={Math.min(zoomStart, zoomEnd)} x2={Math.max(zoomStart, zoomEnd)} strokeOpacity={0.3} fill="var(--accent)" fillOpacity={0.15} />}
              {trendZoom && <Brush dataKey="date" height={24} stroke="var(--border)" fill="var(--bg-surface)" startIndex={trendZoom.left} endIndex={trendZoom.right} travellerWidth={8} />}
            </LineChart>
          </ResponsiveContainer>
          {trendZoom && (
            <button onClick={() => setTrendZoom(null)} style={{ marginTop: 6, padding: '3px 10px', fontSize: 10, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-2)', cursor: 'pointer' }}>
              Reset Zoom
            </button>
          )}
          </>
        ) : <EmptyState icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>} message="No trend data available" />}
      </div>
    ) },
    { id: 'optimization', render: () => (
      <>
        {optimizationOpportunities.length > 0 && (
          <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden', borderLeft: lowScoreCount + orphanedCount > 5 ? '4px solid var(--danger)' : '4px solid var(--warning)' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, var(--danger-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f43f5e', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(244 63 94 / 0.3)' }}>
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
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); setSearchQuery(o.resource.name); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--danger)'; e.currentTarget.style.transform='translateX(4px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(244 63 94 / 0.15)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
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
      </>
    ) },
    { id: 'waste', render: () => (
      <>
        {wasteData && wasteData.items && wasteData.items.length > 0 && (
          <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden', borderLeft: '4px solid var(--warning)' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, var(--warning-dim) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--warning) 0%, #d97706 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(245 158 11 / 0.3)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                </div>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Waste Detection</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{wasteData.totalCount} non-production workloads running 24/7</span>
                </div>
              </div>
              <span style={{ padding: '6px 14px', borderRadius: 12, background: 'linear-gradient(135deg, var(--warning) 0%, #d97706 100%)', color: 'white', fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(245 158 11 / 0.3)' }}>
                ${(wasteData.totalWaste || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo waste
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {wasteData.items.slice(0, 5).map((w: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setSearchQuery(w.name); setCurrentPage(1); }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(245 158 11 / 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{w.resourceGroup} · {w.environment}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: 'var(--warning)', fontSize: 14 }}>${w.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>per month</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    ) },
    { id: 'forecast', render: () => (
      <>
        {periodComparison && (
          <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, rgba(59 130 246 / 0.12) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(99 102 241 / 0.3)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M3 3v18h18" /><path d="M9 17V9M15 17V5M21 17v-4" /></svg>
                </div>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Month-End Forecast</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Based on {periodComparison.currentPeriod?.days || 30} days of data</span>
                </div>
              </div>
              {budgetLimit > 0 && (
                <div style={{ textAlign: 'right' }}>
                  {(() => {
                    const currentTotal = periodComparison.currentPeriod?.totalCost || 0;
                    const projectedMonthly = periodComparison.currentPeriod?.days > 0
                      ? (currentTotal / Number(periodComparison.currentPeriod.days)) * 30
                      : 0;
                    const budgetPct = (projectedMonthly / budgetLimit) * 100;
                    const overBudget = projectedMonthly > budgetLimit;
                    return (
                      <div style={{ padding: '6px 12px', borderRadius: 8, background: overBudget ? 'var(--danger-dim)' : budgetPct > 80 ? 'var(--warning-dim)' : 'var(--accent-dim)', border: `1px solid ${overBudget ? 'var(--danger)' : budgetPct > 80 ? 'var(--warning)' : 'var(--accent)'}` }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: overBudget ? 'var(--danger)' : budgetPct > 80 ? 'var(--warning)' : 'var(--accent)' }}>
                          {overBudget ? 'Over Budget' : budgetPct > 80 ? 'Near Limit' : 'On Track'}
                        </div>
                        <div style={{ fontSize: 10, color: overBudget ? 'var(--danger)' : 'var(--text-2)' }}>
                          ${projectedMonthly.toLocaleString(undefined, { maximumFractionDigits: 0 })} projected
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            {(() => {
              const currentTotal = forecastData ? forecastData.actualCost : (periodComparison.currentPeriod?.totalCost || 0);
              const forecastTotal = forecastData ? forecastData.forecastCost : 0;
              const projectedMonthly = currentTotal + forecastTotal;
              const dayOfMonth = new Date().getDate();
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Actual', value: `$${currentTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: 'incurred', color: 'var(--text-1)' },
                    { label: 'Forecast', value: `$${forecastTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: 'remaining', color: 'var(--accent)' },
                    { label: 'Month-End', value: `$${projectedMonthly.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, sub: 'est. total', color: 'var(--text-1)' },
                    { label: 'On Track', value: budgetLimit > 0 ? `${((budgetLimit / projectedMonthly) * 100 / 30 * dayOfMonth).toFixed(0)}%` : 'N/A', sub: 'of budget used', color: budgetLimit > 0 && projectedMonthly > budgetLimit ? 'var(--danger)' : 'var(--text-1)' },
                  ].map((stat, i) => (
                    <div key={i} style={{ padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{stat.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 3 }}>{stat.sub}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </>
    ) },
    { id: 'commitment', render: () => (
      <>
        {commitmentSavings && (
          <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden', borderLeft: '4px solid var(--accent)' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'var(--accent-dim)', borderRadius: '0 14px 0 100%' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, position: 'relative' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(16 185 129 / 0.3)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              </div>
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Commitment Savings Calculator</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{commitmentSavings.vmCount} VMs · ${commitmentSavings.onDemandMonthly?.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo on-demand</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, position: 'relative' }}>
              {/* 1-Year RI */}
              <div style={{ padding: 16, background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>1-Year Reserved Instance</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--accent)', lineHeight: 1, marginBottom: 4 }}>-{(commitmentSavings.oneYearRI?.savingsPercent || 0).toFixed(0)}%</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 12 }}>vs on-demand pricing</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Monthly rate</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>${(commitmentSavings.oneYearRI?.monthlyRate || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Savings / month</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent)' }}>+${(commitmentSavings.oneYearRI?.savingsMonthly || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Savings / year</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent)' }}>+${(commitmentSavings.oneYearRI?.savingsYear1 || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Break-even</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{commitmentSavings.oneYearRI?.breakEvenMonths || 6} months</span>
                  </div>
                </div>
              </div>
              {/* 3-Year RI */}
              <div style={{ padding: 16, background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>3-Year Reserved Instance</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--warning)', lineHeight: 1, marginBottom: 4 }}>-{(commitmentSavings.threeYearRI?.savingsPercent || 0).toFixed(0)}%</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 12 }}>vs on-demand pricing</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Monthly rate</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>${(commitmentSavings.threeYearRI?.monthlyRate || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Savings / month</span>
                    <span style={{ fontWeight: 700, color: 'var(--warning)' }}>+${(commitmentSavings.threeYearRI?.savingsMonthly || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Savings / 3 years</span>
                    <span style={{ fontWeight: 700, color: 'var(--warning)' }}>+${(commitmentSavings.threeYearRI?.savingsYear3 || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-2)' }}>Break-even</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{commitmentSavings.threeYearRI?.breakEvenMonths || 6} months</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    ) },
    { id: 'topology', render: () => (
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
          <span className="chart-hint-badge" style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', background: 'rgba(245 158 11 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(245 158 11 / 0.2)' }}>Interactive</span>
        </div>
        {resourceTopology.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {resourceTopology.slice(0, 6).map((rg, i) => {
              const maxCost = resourceTopology[0]?.cost || 1;
              const costPercent = maxCost > 0 ? (rg.cost / maxCost) * 100 : 0;
              return (
                <div key={i} style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 14, border: '1px solid var(--border)', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)', cursor: 'pointer', position: 'relative', overflow: 'hidden' }} onClick={() => { setActiveTab('resources'); setRgFilter([rg.name]); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='#f59e0b'; e.currentTarget.style.transform='translateY(-3px) scale(1.01)'; e.currentTarget.style.boxShadow='0 8px 24px rgba(245 158 11 / 0.15)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateY(0) scale(1)'; e.currentTarget.style.boxShadow='none'; }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(245 158 11 / 0.8), rgba(245 158 11 / ${costPercent / 100 * 0.4}))` }} />
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rg.name}>{rg.name}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                    {rg.types.slice(0, 3).map((t, j) => (
                      <span key={j} style={{ fontSize: 10, background: 'var(--accent-dim)', color: 'var(--accent)', padding: '3px 8px', borderRadius: 4, fontWeight: 500, transition: 'all 0.2s ease' }}>{t.type} ({t.count})</span>
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
    ) },
    { id: 'tagAnalysis', render: () => (
      <>
        {(() => {
          const tagged = resources.filter(r => r.tags && Object.keys(r.tags).length > 0);
          const untagged = resources.filter(r => !r.tags || Object.keys(r.tags).length === 0);
          const pct = resources.length > 0 ? (tagged.length / resources.length) * 100 : 0;
          const tagCounts = new Map<string, number>();
          resources.forEach(r => {
            if (r.tags) {
              Object.keys(r.tags).forEach(k => tagCounts.set(k, (tagCounts.get(k) || 0) + 1));
            }
          });
          const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
          return (
            <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, rgba(139 92 246 / 0.12) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139 92 246 / 0.3)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
                  </div>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Tag Completeness</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{resources.length} total resources</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: pct > 70 ? 'var(--accent)' : pct > 40 ? 'var(--warning)' : 'var(--danger)' }}>{pct.toFixed(0)}%</div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>tagged</div>
                  </div>
                </div>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct > 70 ? 'var(--accent)' : pct > 40 ? 'var(--warning)' : 'var(--danger)', borderRadius: 3, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--accent)' }}>{tagged.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>Tagged</div>
                </div>
                <div style={{ padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setCurrentPage(1); }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--danger)' }}>{untagged.length}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>Untagged</div>
                </div>
              </div>
              {topTags.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>Top Tags Used</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {topTags.map(([tag, count]) => (
                      <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-surface)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{tag}</span>
                        <span style={{ color: 'var(--text-3)' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </>
    ) },
    { id: 'riRecommendations', render: () => (
      <>
        {riRecommendations.length > 0 && (
          <div className="card" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 100, height: 100, background: 'radial-gradient(circle at top right, rgba(59 130 246 / 0.15) 0%, transparent 70%)', borderRadius: '0 14px 0 100%' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(59 130 246 / 0.3)' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                </div>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', display: 'block' }}>Reserved Instance Savings</span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Up to 72% cost reduction</span>
                </div>
              </div>
              <div style={{ padding: '6px 14px', borderRadius: 12, background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)', color: 'white', fontSize: 13, fontWeight: 700, boxShadow: '0 2px 8px rgba(16 185 129 / 0.3)' }}>
                ${riRecommendations.reduce((s, r) => s + r.yearlySavings, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14, padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
              💡 Resources with consistent usage could benefit from Azure Reserved Instances
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {riRecommendations.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setRgFilter([r.resourceGroup]); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='#3b82f6'; e.currentTarget.style.transform='translateX(4px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59 130 246 / 0.15)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, var(--blue-dim) 0%, rgba(59 130 246 / 0.3) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid rgba(59 130 246 / 0.2)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.resourceGroup}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.region}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>Save ${r.yearlySavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>${r.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo current</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    ) },
    { id: 'costAnomalies', render: () => (
      <>
        {(costAnomalies.length > 0 || (anomalyData && anomalyData.anomalies.length > 0)) && (
          <div className="card" style={{ padding: 24, borderLeft: '4px solid var(--danger)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(244 63 94 / 0.03) 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--danger-dim)', border: '1px solid rgba(244 63 94 / 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Cost Anomalies Detected</span>
              <span style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 12, background: 'var(--danger-dim)', color: 'var(--danger)', fontSize: 11, fontWeight: 700 }}>
                {(anomalyData?.anomalies.length || costAnomalies.length)} spike{(anomalyData?.anomalies.length || costAnomalies.length) > 1 ? 's' : ''}
              </span>
            </div>
            {anomalyData && anomalyData.anomalies.length > 0 ? (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>
                  Daily cost increases exceeding {anomalyData.threshold}x previous period · {anomalyData.periodStart} to {anomalyData.periodEnd}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {anomalyData.anomalies.slice(0, 8).map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setSearchQuery(a.subscriptionId); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--danger)'; e.currentTarget.style.transform='translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        background: a.ratio >= 3 ? 'var(--danger-dim)' : 'var(--warning-dim)',
                        color: a.ratio >= 3 ? 'var(--danger)' : 'var(--warning)',
                        fontSize: 12, fontWeight: 700
                      }}>
                        {a.ratio >= 3 ? '!!' : '!'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.subscriptionId.slice(0, 18)}...</div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{a.date}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)' }}>+{a.change.toFixed(0)}%</div>
                        <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                          ${a.previousCost.toFixed(0)} → ${a.currentCost.toFixed(0)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>
                  Resources with significant cost increases (&gt;50%) compared to previous period
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {costAnomalies.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', transition: 'all 0.2s ease', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); setSearchQuery(a.resourceGroup); setCurrentPage(1); }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--danger)'; e.currentTarget.style.transform='translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
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
              </>
            )}
          </div>
        )}

        {/* Enhanced ML-based Anomalies */}
        {enhancedAnomalyData && enhancedAnomalyData.anomalies.length > 0 && (
          <div className="card" style={{ padding: 24, marginTop: 16, borderLeft: '4px solid var(--accent)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(16 185 129 / 0.03) 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent-dim)', border: '1px solid rgba(16 185 129 / 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2z" /></svg>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>ML-Based Anomaly Detection</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {Object.entries(enhancedAnomalyData.summary.bySeverity).map(([severity, count]) => (
                  <span key={severity} style={{ padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', background: severity === 'critical' ? 'var(--danger-dim)' : severity === 'high' ? 'rgba(245 158 11 / 0.1)' : 'var(--accent-dim)', color: severity === 'critical' ? 'var(--danger)' : severity === 'high' ? 'var(--warning)' : 'var(--accent)' }}>
                    {severity}: {count}
                  </span>
                ))}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 14 }}>
              Using {enhancedAnomalyData.config.methodsUsed.join(', ')} · Thresholds: z-score {enhancedAnomalyData.config.zScoreThreshold}, MAD {enhancedAnomalyData.config.madThreshold}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {enhancedAnomalyData.anomalies.slice(0, 6).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)', transition: 'all 0.2s ease' }} onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.transform='translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform='translateX(0)'; }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: a.severity === 'critical' ? 'var(--danger-dim)' : a.severity === 'high' ? 'rgba(245 158 11 / 0.1)' : 'var(--accent-dim)',
                    color: a.severity === 'critical' ? 'var(--danger)' : a.severity === 'high' ? 'var(--warning)' : 'var(--accent)',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase'
                  }}>
                    {a.severity?.slice(0, 3)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.subscriptionId?.slice(0, 18)}...</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{a.date} · {a.dayOfWeek}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {a.methods?.map((method, mi) => (
                      <span key={mi} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: 'var(--bg-hover)', color: 'var(--text-2)', textTransform: 'uppercase' }}>
                        {method.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 100 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: a.severity === 'critical' ? 'var(--danger)' : a.severity === 'high' ? 'var(--warning)' : 'var(--accent)' }}>Score: {a.score?.toFixed(1)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                      {a.trend === 'spiking' ? '↗️' : a.trend === 'dropping' ? '↘️' : '→'} ${a.currentCost?.toFixed(0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {enhancedAnomalyLoading && (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-3)', fontSize: 12 }}>
                Analyzing with ML algorithms...
              </div>
            )}
          </div>
        )}
      </>
    ) },
  ];

  // ── Fetch filter options and true total resource count
  useEffect(() => {
    fetch('http://localhost:8080/api/filters')
      .then(r => r.json())
      .then(data => setAllPossibleFilters(data))
      .catch(console.error);

    fetch('http://localhost:8080/api/resources?limit=1')
      .then(r => r.json())
      .then(data => setTrueTotalResources(data.total || 0))
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
    if (showUnattachedDiskOnly) params.append('unattachedDiskOnly', 'true');
    if (showUnassignedPIPOnly) params.append('unassignedPIPOnly', 'true');
    if (showUnattachedNICOnly) params.append('unattachedNICOnly', 'true');
    if (tagFilter) {
      params.append('tagKey', tagFilter.key);
      params.append('tagValue', tagFilter.value);
    }
    params.append('skip', String((currentPage - 1) * itemsPerPage));
    params.append('limit', String(itemsPerPage));
    if (sortConfig.key) { params.append('sortBy', sortConfig.key); params.append('sortOrder', sortConfig.direction); }
    if (piiMasking) params.append('mask', 'true');

    fetch(`http://localhost:8080/api/resources?${params}`)
      .then(r => r.json())
      .then(data => { setResources(data.data || []); setTotalResources(data.total || 0); setFilteredTotalCost(data.totalCost || 0); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [regionFilter, subFilter, rgFilter, typeFilter, debouncedSearch, showOrphanedOnly, showUnattachedDiskOnly, showUnassignedPIPOnly, showUnattachedNICOnly, tagFilter, currentPage, sortConfig, piiMasking]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
    setCurrentPage(1);
  };

  const uniqueRegions = useMemo(() => [...(allPossibleFilters.locations || [])].sort(), [allPossibleFilters.locations]);
  const uniqueSubs = useMemo(() => [...(allPossibleFilters.subs || [])].sort(), [allPossibleFilters.subs]);
  const uniqueRGs = useMemo(() => [...(allPossibleFilters.rgs || [])].sort(), [allPossibleFilters.rgs]);
  const uniqueTypes = useMemo(() => [...(allPossibleFilters.types || [])].sort((a, b) => friendlyType(a).localeCompare(friendlyType(b))), [allPossibleFilters.types]);
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(() => new Set());
  const [selectedSubsInitialized, setSelectedSubsInitialized] = useState(false);

  // Initialize selectedSubs to all subs on first load
  useEffect(() => {
    if (!selectedSubsInitialized && uniqueSubs.length > 0) {
      setSelectedSubs(new Set(uniqueSubs));
      setSelectedSubsInitialized(true);
    }
  }, [uniqueSubs, selectedSubsInitialized]);

  const activeSubs = useMemo(() => {
    if (selectedSubs.size === 0) return uniqueSubs;
    return uniqueSubs.filter(s => selectedSubs.has(s));
  }, [uniqueSubs, selectedSubs]);


  // Fetch daily costs for dashboard trends - aggregate across all active subscriptions
  useEffect(() => {
    if (activeSubs.length === 0) return;
    const params = new URLSearchParams();
    activeSubs.forEach(s => params.append('subscriptionId', s));
    params.append('period', costPeriod);
    fetch(`http://localhost:8080/api/costs/daily?${params}`)
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
  }, [activeSubs, costPeriod]);

  // Fetch commitment savings data
  useEffect(() => {
    fetch('http://localhost:8080/api/commitment/savings')
      .then(r => r.json())
      .then(data => { if (!data.error) setCommitmentSavings(data); })
      .catch(() => {});
  }, []);

  // Fetch cost by resource type daily trend
  useEffect(() => {
    if (activeSubs.length === 0) return;
    const subId = uniqueSubs[0];
    fetch(`http://localhost:8080/api/costs/by-type/daily?subscriptionId=${subId}&period=${costPeriod}`)
      .then(r => r.json())
      .then(data => { if (!data.error) setTypeTrendData(data); })
      .catch(() => {});
  }, [activeSubs, costPeriod]);

  // Fetch waste detection data
  useEffect(() => {
    fetch('http://localhost:8080/api/waste/detect')
      .then(r => r.json())
      .then(data => { if (!data.error) setWasteData(data); })
      .catch(() => {});
  }, []);

  // Fetch period-over-period cost comparison
  useEffect(() => {
    if (activeSubs.length === 0) return;
    const params = new URLSearchParams();
    activeSubs.forEach(s => params.append('subscriptionId', s));
    fetch(`http://localhost:8080/api/costs/comparison?${params}&days=${costPeriod}`)
      .then(r => r.json())
      .then(data => { if (!data.error) setPeriodComparison(data); })
      .catch(() => {});
  }, [activeSubs, costPeriod]);

  // Fetch Azure AI-powered forecast
  useEffect(() => {
    if (activeSubs.length === 0) return;
    const params = new URLSearchParams();
    activeSubs.forEach(s => params.append('subscriptionId', s));
    fetch(`http://localhost:8080/api/costs/forecast?${params}&days=${costPeriod}`)
      .then(r => r.json())
      .then(data => { if (!data.error && data.actualCost !== undefined) setForecastData(data); })
      .catch(() => {});
  }, [activeSubs, costPeriod]);

  // Fetch cost anomalies from backend
  useEffect(() => {
    if (activeSubs.length === 0) return;
    const params = new URLSearchParams();
    activeSubs.forEach(s => params.append('subscriptionId', s));
    fetch(`http://localhost:8080/api/costs/anomalies?${params}`)
      .then(r => r.json())
      .then(data => { if (data.anomalies) setAnomalyData(data); })
      .catch(() => {});
  }, [activeSubs]);

  // Fetch enhanced ML-based anomalies
  useEffect(() => {
    if (activeSubs.length === 0) return;
    setEnhancedAnomalyLoading(true);
    const params = new URLSearchParams();
    activeSubs.forEach(s => params.append('subscriptionId', s));
    fetch(`http://localhost:8080/api/costs/anomalies/enhanced?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.anomalies) {
          setEnhancedAnomalyData(data);
        }
        setEnhancedAnomalyLoading(false);
      })
      .catch(() => { setEnhancedAnomalyLoading(false); });
  }, [activeSubs]);

  // Fetch SLA / VM uptime data
  useEffect(() => {
    if (activeSubs.length === 0) return;
    const params = new URLSearchParams();
    activeSubs.forEach(s => params.append('subscriptionId', s));
    fetch(`http://localhost:8080/api/sla?${params}&days=30`)
      .then(r => r.json())
      .then(data => { if (data.data) setSlaData(data); })
      .catch(() => {});
  }, [activeSubs]);

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
    const toFetch = activeSubs.filter(s => !existing.has(s));
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
          setDataSubIds(prev => new Set(prev).add(subId));
        } else if (msg.type === 'done') {
          es.close();
          setCostsLoading(false);
          setIsRefreshing(false);
        }
      } catch (err) {
        console.error('SSE parse error', err);
      }
    };

    es.onerror = () => {
      es.close();
      setCostsLoading(false);
      setIsRefreshing(false);
    };
  };

  const refreshCosts = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setCosts([]);
    setDataSubIds(new Set());
    try {
      await fetch('http://localhost:8080/api/costs/cache', { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to clear cost cache', err);
    }
    
    // Also refresh filters so that uniqueSubs gets populated if it failed on initial load
    try {
      const fRes = await fetch('http://localhost:8080/api/filters');
      const fData = await fRes.json();
      setAllPossibleFilters(fData);
    } catch (err) {
      console.error('Failed to fetch filters', err);
    }
    
    // We intentionally don't call fetchCosts(true) immediately here because setAllPossibleFilters
    // is async. The useEffect observing uniqueSubs will automatically trigger fetchCosts()
    // once uniqueSubs populates. If it's already populated correctly, we can enforce a
    // fetchCosts call right now, but wait for state to settle.
    fetchCosts(true);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (uniqueSubs.length > 0) fetchCosts(); }, [uniqueSubs]);

  // Auto-complete loading when all subscription data has arrived (don't wait for SSE "done")
  useEffect(() => {
    if (dataSubIds.size > 0 && dataSubIds.size === uniqueSubs.length && costsLoading) {
      setCostsLoading(false);
      setIsRefreshing(false);
    }
  }, [dataSubIds, uniqueSubs, costsLoading]);

  // Fetch resource change history
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('http://localhost:8080/api/history?limit=100');
      const data = await res.json();
      if (Array.isArray(data)) {
        setHistory(data);
      } else {
        console.error('History API returned non-array:', data);
        setHistory([]);
      }
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


  const exportCSV = () => {
    const params = new URLSearchParams();
    regionFilter.forEach(f => params.append('location', f));
    subFilter.forEach(f => params.append('subscriptionId', f));
    rgFilter.forEach(f => params.append('resourceGroup', f));
    if (typeFilter) params.append('type', typeFilter);
    if (debouncedSearch) params.append('search', debouncedSearch);
    if (piiMasking) params.append('mask', 'true');
    window.open(`http://localhost:8080/api/export?${params}`, '_blank');
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Title
    doc.setFontSize(20);
    doc.setTextColor(16, 185, 129);
    doc.text('CloudViz FinOps Report', pageWidth / 2, y, { align: 'center' });
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Summary stats
    doc.setFontSize(14);
    doc.setTextColor(30);
    doc.text('Cost Summary', 20, y);
    y += 8;

    doc.setFontSize(10);
    doc.setTextColor(60);
    const totalCostFormatted = `$${(filteredTotalCost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const resourceCount = totalResources || 0;
    doc.text(`Total Monthly Cost: ${totalCostFormatted}`, 20, y); y += 6;
    doc.text(`Total Resources: ${resourceCount}`, 20, y); y += 6;
    doc.text(`Orphaned Resources: ${orphanedCount || 0}`, 20, y); y += 6;
    doc.text(`Potential Monthly Savings: $${(totalPotentialSavings || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 20, y); y += 12;

    // Top cost by type
    if (costsByType.length > 0) {
      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.text('Cost by Resource Type', 20, y);
      y += 8;

      doc.setFontSize(9);
      doc.setTextColor(60);
      costsByType.slice(0, 8).forEach(item => {
        doc.text(`${item.name}: $${item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 25, y);
        y += 5;
        if (y > 270) { doc.addPage(); y = 20; }
      });
      y += 8;
    }

    // Optimization opportunities
    if (optimizationOpportunities.length > 0) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.text('Top Optimization Opportunities', 20, y);
      y += 8;

      doc.setFontSize(9);
      doc.setTextColor(60);
      optimizationOpportunities.slice(0, 10).forEach((o: { resource: { name: string }; reason: string; potentialSavings: number }) => {
        doc.text(`• ${o.resource.name}: ${o.reason} ($${o.potentialSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo)`, 25, y);
        y += 5;
        if (y > 270) { doc.addPage(); y = 20; }
      });
      y += 8;
    }

    // Budget status
    if (budgetLimit > 0) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.text('Budget Status', 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setTextColor(60);
      const budgetPct = filteredTotalCost > 0 ? ((filteredTotalCost / budgetLimit) * 100).toFixed(1) : '0';
      doc.text(`Budget Limit: $${budgetLimit.toLocaleString()}`, 20, y); y += 6;
      doc.text(`Current Spend: ${budgetPct}% of budget`, 20, y); y += 12;
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('CloudViz - Azure FinOps Dashboard', pageWidth / 2, 290, { align: 'center' });

    doc.save(`cloudviz-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const debouncedCostSearch = useDebounce(costSearchQuery, 300);

  const filteredCosts = useMemo(() => {
    let result = costs;

    // Filter by Environment tag when tagFilter is set (from chart click)
    if (tagFilter?.key === 'Environment') {
      result = result.filter(c => {
        // Find matching resource to get its actual Environment tag
        const matchingResource = resources.find(r =>
          r.resourceGroup?.toLowerCase() === (c.resourceGroup || '').toLowerCase() &&
          (r.type?.toLowerCase().includes(c.resourceType?.toLowerCase() || '') ||
           (c.resourceType || '').toLowerCase().includes(r.type?.toLowerCase() || '')) &&
          (r.location?.toLowerCase().replace(/\s/g, '') === (c.resourceLocation || '').toLowerCase())
        );
        const envTag = matchingResource?.tags?.Environment ||
                      matchingResource?.tags?.environment ||
                      matchingResource?.tags?.env ||
                      'Untagged';
        return envTag === tagFilter.value;
      });
    }

    // Filter by search query
    if (debouncedCostSearch) {
      const q = debouncedCostSearch.toLowerCase();
      result = result.filter(c =>
        (c.resourceGroup || '').toLowerCase().includes(q) ||
        (c.resourceType || '').toLowerCase().includes(q) ||
        (c.resourceLocation || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [costs, debouncedCostSearch, tagFilter, resources]);

  const totalCostsSum = useMemo(() => costs.reduce((s, c) => s + c.cost, 0), [costs]);

  // Dashboard computed values
  const costsByType = useMemo(() => {
    const map = new Map<string, { value: number; raw: string }>();
    costs.forEach(c => {
      const raw = c.resourceType || 'Other';
      const type = friendlyType(raw);
      const existing = map.get(type);
      if (existing) {
        existing.value += c.cost;
      } else {
        map.set(type, { value: c.cost, raw });
      }
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, value: data.value, raw: data.raw })).sort((a, b) => b.value - a.value).slice(0, 8);
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

  // Azure AI-powered forecast (actual + projected remainder)
  const forecastedMonthlyCost = useMemo(() => {
    if (!forecastData || forecastData.actualCost === undefined) return null;
    return forecastData.actualCost + forecastData.forecastCost;
  }, [forecastData]);

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
    let currentTotal = 0, previousTotal = 0;
    costs.forEach(c => {
      currentTotal += c.cost;
      previousTotal += c.previousCost || 0;
    });
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

  const COLORS = useMemo(() => isDarkMode
    ? ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']
    : ['#059669', '#2563eb', '#d97706', '#e11d48', '#7c3aed', '#db2777', '#0891b2', '#65a30d'],
    [isDarkMode]
  );

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
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)' }}>
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
          <button className={`tab ${activeTab === 'resources' ? 'active' : ''}`} onClick={() => setActiveTab('resources')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
            Resources
            {resources.length > 0 && (
              <span style={{
                marginLeft: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: activeTab === 'resources' ? 'var(--accent)' : 'var(--bg-surface)',
                color: activeTab === 'resources' ? 'white' : 'var(--text-2)',
                fontSize: 11,
                fontWeight: 700,
                border: `1px solid ${activeTab === 'resources' ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.2s ease'
              }}>
                {resources.length.toLocaleString()}
              </span>
            )}
          </button>
          <button className={`tab ${activeTab === 'costs' ? 'active' : ''}`} onClick={() => setActiveTab('costs')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            Cost Forecast
          </button>
          <button className={`tab ${activeTab === 'comparisons' ? 'active' : ''}`} onClick={() => setActiveTab('comparisons')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M9 17V7m0 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10V7m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2" /></svg>
            Comparisons
          </button>
          <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            History
            {history.length > 0 && (
              <span style={{
                marginLeft: 4,
                padding: '2px 8px',
                borderRadius: 12,
                background: activeTab === 'history' ? 'var(--accent)' : 'var(--bg-surface)',
                color: activeTab === 'history' ? 'white' : 'var(--text-2)',
                fontSize: 11,
                fontWeight: 700,
                border: `1px solid ${activeTab === 'history' ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 0.2s ease'
              }}>
                {history.length.toLocaleString()}
              </span>
            )}
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Sync indicator when loading costs */}
        {costsLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', marginRight: 8 }}>
            <div className="sync-spinner" style={{ width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--accent)' }}>Syncing ({dataSubIds.size}/{uniqueSubs.length} subs)...</span>
          </div>
        )}

        {/* Subscription filter */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              const next = new Set(selectedSubs);
              if (next.size === uniqueSubs.length) {
                // all selected → deselect all but first
                const first = uniqueSubs[0];
                next.clear();
                next.add(first);
              } else {
                // some selected → select all
                uniqueSubs.forEach(s => next.add(s));
              }
              setSelectedSubs(next);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 12, fontWeight: 500, cursor: 'pointer', marginRight: 6 }}
            title="Toggle all subscriptions"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <span>{activeSubs.length === uniqueSubs.length ? 'All' : activeSubs.length} / {uniqueSubs.length} subs</span>
          </button>
        </div>

        {/* Manual refresh button */}
        <button
          onClick={refreshCosts}
          disabled={isRefreshing}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: isRefreshing ? 'var(--accent-dim)' : 'var(--bg-surface)', color: isRefreshing ? 'var(--accent)' : 'var(--text-2)', fontSize: 12, fontWeight: 500, cursor: isRefreshing ? 'default' : 'pointer', marginRight: 6, transition: 'all 0.15s ease' }}
          title="Refresh cost data from Azure"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>

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
          regionFilter={regionFilter} subFilter={subFilter} rgFilter={rgFilter} typeFilter={typeFilter}
          showOrphanedOnly={showOrphanedOnly} showUnattachedDiskOnly={showUnattachedDiskOnly} showUnassignedPIPOnly={showUnassignedPIPOnly} showUnattachedNICOnly={showUnattachedNICOnly} showFavoritesOnly={showFavoritesOnly}
          setRegionFilter={setRegionFilter} setSubFilter={setSubFilter} setRgFilter={setRgFilter} setTypeFilter={setTypeFilter}
          setShowOrphanedOnly={setShowOrphanedOnly} setShowUnattachedDiskOnly={setShowUnattachedDiskOnly}
          setShowUnassignedPIPOnly={setShowUnassignedPIPOnly} setShowUnattachedNICOnly={setShowUnattachedNICOnly} setShowFavoritesOnly={setShowFavoritesOnly}
          setCurrentPage={setCurrentPage}
          favorites={favorites}
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
                  <button className="btn" onClick={exportPDF} title="Export report as PDF" style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)', color: 'white', border: 'none' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                    Export PDF
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
                  <button className="btn" onClick={() => setShowSettings(true)} title="Settings (⌘S / Ctrl+S)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                    Settings
                  </button>
                  <button className="btn" onClick={() => setShowShortcutsHelp(true)} title="Keyboard shortcuts (?)" style={{ padding: '8px 10px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M6 8h.01M6 12h.01M6 16h.01" /></svg>
                    <kbd style={{ fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>?</kbd>
                  </button>
                  <button className="btn" onClick={() => { const name = prompt('Preset name:'); if (!name) return; const preset = { name, regionFilter, subFilter, rgFilter, typeFilter, showOrphanedOnly, showUnattachedDiskOnly, showUnassignedPIPOnly, showUnattachedNICOnly }; const saved = JSON.parse(localStorage.getItem('cloudviz-filterPresets') || '[]'); localStorage.setItem('cloudviz-filterPresets', JSON.stringify([...saved, preset])); setFilterPresets([...filterPresets, preset]); }} title="Save current filters as preset">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    Save Filters
                  </button>
                  {filterPresets.length > 0 && (
                    <select
                      onChange={e => {
                        const idx = parseInt(e.target.value);
                        if (idx === -1) return;
                        const p = filterPresets[idx];
                        setRegionFilter(p.regionFilter);
                        setSubFilter(p.subFilter);
                        setRgFilter(p.rgFilter);
                        setTypeFilter(p.typeFilter);
                        setShowOrphanedOnly(p.showOrphanedOnly);
                        setShowUnattachedDiskOnly(p.showUnattachedDiskOnly);
                        setShowUnassignedPIPOnly(p.showUnassignedPIPOnly);
                        setShowUnattachedNICOnly(p.showUnattachedNICOnly);
                        setCurrentPage(1);
                        e.target.value = '-1';
                      }}
                      defaultValue="-1"
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 12, cursor: 'pointer' }}
                    >
                      <option value="-1">Load Preset...</option>
                      {filterPresets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
                    </select>
                  )}
                </div>
              </div>

              {/* Dashboard panels */}
              {dashboardPanels.map(({ id, render }) => (
                <PanelWrapper key={id} id={id}>
                  {render()}
                </PanelWrapper>
              ))}

            </div>
          ) : activeTab === 'resources' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {/* Search */}
                <div className="search-input-wrap" style={{ maxWidth: 340 }}>
                  <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  <input
                    ref={searchInputRef}
                    className="search-input"
                    type="text"
                    placeholder="Search by name, type, resource group..."
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  />
                </div>

                {tagFilter && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.2)', borderRadius: 20, fontSize: 11, fontWeight: 600, color: '#ec4899' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
                    <span>{tagFilter.key}: {tagFilter.value}</span>
                    <button style={{ border: 'none', background: 'transparent', color: '#ec4899', cursor: 'pointer', display: 'flex', padding: 2, marginLeft: 4 }} onClick={() => { setTagFilter(null); setCurrentPage(1); }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}

                {/* Stats */}
                <div style={{ display: 'flex', gap: 20, marginLeft: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="stat-pill" style={{ position: 'relative' }}>
                    <span className="stat-label">Total Cost</span>
                    <span className="stat-value">${filteredTotalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>for {totalResources.toLocaleString()} resources</span>
                  </div>
                  <div className="stat-pill">
                    <span className="stat-label">Showing</span>
                    <span className="stat-value neutral">{(showFavoritesOnly ? resources.filter(r => favorites.has(r.id)) : resources).length.toLocaleString()}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>of {totalResources.toLocaleString()}</span>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={exportCSV}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                      Export CSV
                    </button>
                    <button className="btn" onClick={refreshCosts} disabled={costsLoading}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: costsLoading ? 'spin 0.8s linear infinite' : 'none' }}><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                      Refresh Costs
                    </button>
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
                  resources={showFavoritesOnly ? resources.filter(r => favorites.has(r.id)) : resources}
                  sortConfig={sortConfig}
                  onSort={handleSort}
                  onLocationClick={loc => { setRegionFilter([loc]); setCurrentPage(1); }}
                  onRgClick={rg => { setRgFilter([rg]); setCurrentPage(1); }}
                  onSubClick={sub => { setSubFilter([sub]); setCurrentPage(1); }}
                  onTypeClick={type => { setTypeFilter(type); setCurrentPage(1); }}
                  onResourceClick={r => { setSelectedResource(r); fetchAIInsights(r); clearSelection(); }}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                  selected={selectedResources}
                  onSelect={toggleSelection}
                  onSelectAll={selectAll}
                  onBulkExport={bulkExportSelected}
                />
              )}

            </div>
          ) : activeTab === 'costs' ? (
            /* ── Costs Tab ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Costs Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent) 0%, #059669 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(16 185 129 / 0.3)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                  </div>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>Cost Management</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 12 }}>
                      {totalResources > 0 ? `$${(totalCostsSum || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} total · ${costs.length} line items` : 'Loading...'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    <input
                      type="text"
                      placeholder="Filter costs..."
                      value={costSearchQuery}
                      onChange={e => setCostSearchQuery(e.target.value)}
                      style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, color: 'var(--text-1)', width: 140 }}
                    />
                  </div>
                  {/* Environment Filter */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['All', 'Production', 'Development', 'Staging', 'Test/QA'].map(env => {
                      const isActive = envFilter === env || (env === 'All' && !envFilter);
                      return (
                        <button key={env} onClick={() => setEnvFilter(env === 'All' ? '' : env)} style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: '1px solid', borderColor: isActive ? 'var(--accent)' : 'var(--border)', borderRadius: 6, background: isActive ? 'var(--accent)' : 'transparent', color: isActive ? 'white' : 'var(--text-2)', cursor: 'pointer' }}>
                          {env}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cost Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                {[
                  { label: 'Total Cost', value: `$${(totalCostsSum || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, color: 'var(--accent)' },
                  { label: 'Production', value: `$${costsByEnvironment.find(e => e.name === 'Production')?.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '0'}`, color: '#ef4444' },
                  { label: 'Development', value: `$${costsByEnvironment.find(e => e.name === 'Development')?.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '0'}`, color: '#f59e0b' },
                  { label: 'Staging', value: `$${costsByEnvironment.find(e => e.name === 'Staging')?.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '0'}`, color: '#8b5cf6' },
                  { label: 'Untagged', value: `$${costsByEnvironment.find(e => e.name === 'Untagged')?.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '0'}`, color: 'var(--text-3)' },
                ].map((stat, i) => (
                  <div key={i} className="card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{stat.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Cost by Environment Bar Chart */}
              {costsByEnvironment.length > 0 && (
                <div className="card" style={{ padding: 24 }}>
                  <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Cost Distribution by Environment</span>
                    <span className="chart-hint-badge" style={{ fontSize: 10, fontWeight: 600, color: '#22c55e', background: 'rgba(34 197 94 / 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(34 197 94 / 0.2)' }}>Interactive</span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={costsByEnvironment.filter(e => e.value > 0)} margin={{ left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-2)', fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const val = payload[0].value;
                          return (
                            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', padding: 12, minWidth: 160 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 6, borderBottom: '1px solid #334155', paddingBottom: 6 }}>
                                {label}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                <span style={{ fontSize: 11, color: '#94a3b8' }}>Cost</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>
                                  ${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="value"
                        radius={[4, 4, 0, 0]}
                        onClick={(data: any) => {
                          if (data?.name) {
                            setActiveTab('resources');
                            setTagFilter({ key: 'Environment', value: data.name });
                            setCurrentPage(1);
                            // Sync envFilter for Cost Details table - "Untagged" maps to "Unknown" in inferred env
                            if (data.name === 'Untagged') {
                              setEnvFilter('Unknown');
                            } else if (['Production', 'Development', 'Staging', 'Test/QA'].includes(data.name)) {
                              setEnvFilter(data.name);
                            }
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {costsByEnvironment.filter(e => e.value > 0).map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} style={{ cursor: 'pointer', outline: 'none' }} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Cost Table */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Cost Details</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{filteredCosts.length} items</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {[
                          { key: 'resourceGroup', label: 'Resource Group' },
                          { key: 'resourceType', label: 'Type' },
                          { key: 'resourceLocation', label: 'Location' },
                          { key: 'cost', label: 'Cost' },
                        ].map(col => (
                          <th
                            key={col.key}
                            onClick={() => setCostSortConfig(prev => ({ key: col.key as keyof CostItem, direction: prev.key === col.key && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                            style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {col.label}
                              {costSortConfig.key === col.key && (
                                <span style={{ color: 'var(--accent)', fontSize: 10 }}>{costSortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...filteredCosts]
                        .filter(cost => {
                          if (!envFilter) return true;
                          const inferred = inferEnvFromRG(cost.resourceGroup || '');
                          if (envFilter === 'Production') return inferred === 'Production';
                          if (envFilter === 'Development') return inferred === 'Development';
                          if (envFilter === 'Staging') return inferred === 'Staging';
                          if (envFilter === 'Test/QA') return inferred === 'Test/QA';
                          if (envFilter === 'Unknown') return inferred === 'Unknown';
                          return true;
                        })
                        .sort((a, b) => {
                          if (!costSortConfig.key) return 0;
                          const key = costSortConfig.key;
                          const aVal = a[key];
                          const bVal = b[key];
                          if (typeof aVal === 'number' && typeof bVal === 'number') {
                            return costSortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
                          }
                          return costSortConfig.direction === 'asc'
                            ? String(aVal).localeCompare(String(bVal))
                            : String(bVal).localeCompare(String(aVal));
                        })
                        .slice(0, 100).map((cost, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setActiveTab('resources'); }}>
                          <td style={{ padding: '10px 16px', color: 'var(--text-1)', fontWeight: 500 }}>{cost.resourceGroup || '—'}</td>
                          <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{friendlyType(cost.resourceType || 'unknown')}</td>
                          <td style={{ padding: '10px 16px', color: 'var(--text-2)' }}>{cost.resourceLocation || '—'}</td>
                          <td style={{ padding: '10px 16px', color: 'var(--accent)', fontWeight: 700 }}>${cost.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredCosts.length === 0 && (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>No cost data available</div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === 'comparisons' ? (
            /* ── Comparisons Tab ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Comparisons Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(139 92 246 / 0.3)' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M9 17V7m0 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 10V7m0 10a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2" /></svg>
                  </div>
                  <div>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>Comparisons</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 12 }}>Compare resource groups and subscriptions</span>
                  </div>
                </div>

                {/* Comparisons Search */}
                <div style={{ position: 'relative', minWidth: 300 }}>
                  <div style={{ position: 'relative' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                    <input
                      ref={comparisonsSearchInputRef}
                      type="text"
                      placeholder="Search resources..."
                      value={comparisonsSearchQuery}
                      onChange={(e) => setComparisonsSearchQuery(e.target.value)}
                      onFocus={() => setComparisonsSearchFocused(true)}
                      onBlur={() => setTimeout(() => setComparisonsSearchFocused(false), 200)}
                      style={{
                        width: '100%',
                        padding: '10px 12px 10px 40px',
                        borderRadius: 10,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-surface)',
                        color: 'var(--text-1)',
                        fontSize: 14,
                        outline: 'none',
                      }}
                    />
                    {comparisonsSearchQuery && (
                      <button
                        onClick={() => { setComparisonsSearchQuery(''); comparisonsSearchInputRef.current?.focus(); }}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Dropdown */}
                  {comparisonsSearchFocused && comparisonsSearchQuery && (() => {
                    // Collect all resources from both comparisons
                    const allResources: Array<{ name: string; type: string; rg?: string; sub?: string; side: 'left' | 'right' }> = [];

                    if (rgComparison) {
                      rgComparison.rg1.resourcesByType?.forEach((t: any) => {
                        t.resources.forEach((r: any) => {
                          if (r.name.toLowerCase().includes(comparisonsSearchQuery.toLowerCase())) {
                            allResources.push({ name: r.name, type: t.type, rg: rgComparison.rg1.resourceGroup, side: 'left' });
                          }
                        });
                      });
                      rgComparison.rg2.resourcesByType?.forEach((t: any) => {
                        t.resources.forEach((r: any) => {
                          if (r.name.toLowerCase().includes(comparisonsSearchQuery.toLowerCase())) {
                            allResources.push({ name: r.name, type: t.type, rg: rgComparison.rg2.resourceGroup, side: 'right' });
                          }
                        });
                      });
                    }

                    if (subComparison) {
                      subComparison.sub1.resourcesByType?.forEach((t: any) => {
                        t.resources.forEach((r: any) => {
                          if (r.name.toLowerCase().includes(comparisonsSearchQuery.toLowerCase())) {
                            allResources.push({ name: r.name, type: t.type, sub: subComparison.sub1.subscriptionId.slice(0, 8), side: 'left' });
                          }
                        });
                      });
                      subComparison.sub2.resourcesByType?.forEach((t: any) => {
                        t.resources.forEach((r: any) => {
                          if (r.name.toLowerCase().includes(comparisonsSearchQuery.toLowerCase())) {
                            allResources.push({ name: r.name, type: t.type, sub: subComparison.sub2.subscriptionId.slice(0, 8), side: 'right' });
                          }
                        });
                      });
                    }

                    const uniqueResources = allResources.slice(0, 8);

                    if (uniqueResources.length === 0) return null;

                    return (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)', zIndex: 100, maxHeight: 300, overflow: 'auto' }}>
                        {uniqueResources.map((res, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setComparisonsSearchQuery(res.name);
                              setComparisonsSearchFocused(false);
                              // Expand the type for this resource
                              const newSet = new Set(rgExpandedTypes);
                              newSet.add(res.type);
                              setRgExpandedTypes(newSet);
                            }}
                            style={{ width: '100%', padding: '10px 16px', border: 'none', borderBottom: idx < uniqueResources.length - 1 ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{res.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{friendlyType(res.type)} • {res.rg || res.sub} • {res.side === 'left' ? 'Left' : 'Right'}</div>
                            </div>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent)', flexShrink: 0 }}><path d="M9 18l6-6-6-6" /></svg>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Comparison Panels with search filter */}
              {renderRGComparison()}
              {renderSubComparison()}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    {history.length > 0 && (() => {
                      const totalCost = history.reduce((sum, h) => sum + (h.cost || 0), 0);
                      return totalCost > 0 ? (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Monthly Cost</div>
                          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--accent)' }}>
                            ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      ) : null;
                    })()}
                    <button className="btn" onClick={() => fetchHistory()} disabled={historyLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {historyLoading ? <div className="spinner" style={{ width: 14, height: 14 }} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>}
                      Refresh
                    </button>
                  </div>
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
                        onClick={() => {
                          // Skip deleted resources - they no longer exist
                          if (h.changeType === 'deleted') {
                            setAlertModal({
                              open: true,
                              title: 'Resource Deleted',
                              message: `This resource was deleted and is no longer available.\n\nName: ${h.resourceName}\nDeleted: ${new Date(h.timestamp).toLocaleString()}`,
                              icon: 'danger',
                            });
                            return;
                          }
                          // Find the resource and navigate to it
                          const resource = resources.find(r => r.id === h.resourceId);
                          if (resource) {
                            setSelectedResource(resource);
                            setCurrentPage(1);
                          } else {
                            // Resource not loaded, fetch it
                            fetch(`http://localhost:8080/api/resources?id=${encodeURIComponent(h.resourceId)}`)
                              .then(r => r.json())
                              .then(data => {
                                if (data.data && data.data.length > 0) {
                                  // Validate the returned resource matches the requested ID
                                  const foundResource = data.data.find((r: AzureResource) => r.id === h.resourceId);
                                  if (foundResource) {
                                    setSelectedResource(foundResource);
                                    setCurrentPage(1);
                                  } else {
                                    setAlertModal({
                                      open: true,
                                      title: 'Resource Not Found',
                                      message: `Resource not found. It may have been deleted or the ID has changed.\n\nName: ${h.resourceName}`,
                                      icon: 'warning',
                                    });
                                  }
                                } else {
                                  setAlertModal({
                                    open: true,
                                    title: 'Resource Not Found',
                                    message: `Resource not found. It may have been deleted or the ID has changed.\n\nName: ${h.resourceName}`,
                                    icon: 'warning',
                                  });
                                }
                              })
                              .catch(err => {
                                console.error('Failed to fetch resource:', err);
                                setAlertModal({
                                  open: true,
                                  title: 'Failed to Load',
                                  message: `Failed to load resource details.\n\nName: ${h.resourceName}`,
                                  icon: 'danger',
                                });
                              });
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 16,
                          padding: 16,
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          borderLeft: `3px solid ${borderColor}`,
                          borderRadius: 12,
                          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                          position: 'relative',
                          overflow: 'hidden',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.transform = 'translateX(6px)'; e.currentTarget.style.boxShadow = `0 4px 16px ${borderColor}15`; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <div style={{ position: 'absolute', inset: 0, background: `${borderColor}08`, opacity: 0, transition: 'opacity 0.2s ease' }} />
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: bgColor,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: `1px solid ${borderColor}33`,
                          position: 'relative',
                          zIndex: 1
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: h.cost > 0 ? 2 : 4 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{h.resourceName}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 500, padding: '2px 6px', background: 'var(--bg-surface)', borderRadius: 4, border: '1px solid var(--border)' }}>
                              {friendlyType(h.resourceType)}
                            </span>
                          </div>
                          {h.cost > 0 && (
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
                              ${h.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /mo
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                            {isCreated ? (
                              <span style={{ color: 'var(--accent)' }}>New resource added to inventory</span>
                            ) : isDeleted ? (
                              <span style={{ color: 'var(--danger)' }}>Resource removed from inventory</span>
                            ) : (
                              <span>
                                <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{h.field === 'resourceGroup' ? 'Resource Group' : h.field === 'resourceLocation' ? 'Location' : h.field === 'subscriptionId' ? 'Subscription' : h.field.charAt(0).toUpperCase() + h.field.slice(1)}</span>
                                {': '}
                                {h.field === 'tags' ? (
                                  <span>
                                    <span style={{ color: 'var(--danger)' }}>{h.oldValue ? `${Object.keys(JSON.parse(h.oldValue || '{}')).length} tags` : '(no tags)'}</span>
                                    <span style={{ margin: '0 6px', color: 'var(--text-3)' }}>→</span>
                                    <span style={{ color: 'var(--accent)' }}>{h.newValue ? `${Object.keys(JSON.parse(h.newValue || '{}')).length} tags` : '(no tags)'}</span>
                                  </span>
                                ) : (
                                  <>
                                    <span style={{ color: 'var(--danger)' }}>{h.oldValue || '(empty)'}</span>
                                    <span style={{ margin: '0 6px', color: 'var(--text-3)' }}>→</span>
                                    <span style={{ color: 'var(--accent)' }}>{h.newValue || '(empty)'}</span>
                                  </>
                                )}
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
                    <button className="btn" onClick={refreshCosts} disabled={costsLoading}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: costsLoading ? 'spin 0.8s linear infinite' : 'none' }}><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                      Refresh Costs
                    </button>
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
                  Syncing financial data ({dataSubIds.size}/{uniqueSubs.length} subscriptions)...

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
                        style={{ position: 'relative', textAlign: 'left', width: '100%', overflow: 'hidden' }}
                      >
                        {/* Background gradient */}
                        <div style={{ position: 'absolute', top: 0, right: 0, width: '50%', height: '100%', background: trendUp ? 'linear-gradient(135deg, transparent, rgba(244 63 94 / 0.08))' : 'linear-gradient(135deg, transparent, rgba(16 185 129 / 0.08))', pointerEvents: 'none' }} />

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
                            border: `1px solid ${trendUp ? 'var(--danger)' : 'var(--accent)'}33`,
                            boxShadow: trendUp ? '0 2px 8px rgba(244 63 94 / 0.2)' : '0 2px 8px rgba(16 185 129 / 0.2)'
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
                onResourceClick={r => { setSelectedCost(null); setSelectedResource(r); fetchAIInsights(r); clearSelection(); }}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                selected={selectedResources}
                onSelect={toggleSelection}
                onSelectAll={selectAll}
                onBulkExport={bulkExportSelected}
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
          onViewDependencies={() => setShowDependencyGraph(true)}
        />
      )}

      {/* ── Dependency Graph modal ── */}
      {selectedResource && showDependencyGraph && (
        <DependencyGraphModal
          resource={selectedResource}
          onClose={() => setShowDependencyGraph(false)}
          onResourceClick={(resource) => {
            setSelectedResource(resource);
            setCurrentPage(1);
          }}
          allResources={resources}
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
                  <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>Settings</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Preferences, budget, and data management</div>
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

              {/* Webhook URL */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Webhook URL for Alerts
                </label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 14, transition: 'border-color 0.2s ease, box-shadow 0.2s ease' }}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)'; }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                  Optional: Receive webhook notifications when budget alerts are triggered (Slack, Teams, custom URL)
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

              {/* Appearance */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Appearance
                </label>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                    <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>Dark Mode</span>
                  </div>
                  <button
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    style={{ width: 44, height: 24, borderRadius: 12, background: isDarkMode ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s ease' }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, left: isDarkMode ? 23 : 3, transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </button>
                </div>
              </div>

              {/* Default Period */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Default Cost Period
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['7', '30', '90'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => { localStorage.setItem('cloudviz-default-period', p); setCostPeriod(p); }}
                      style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid', borderColor: costPeriod === p ? 'var(--accent)' : 'var(--border)', background: costPeriod === p ? 'var(--accent)' : 'transparent', color: costPeriod === p ? 'white' : 'var(--text-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s ease' }}
                    >
                      {p} days
                    </button>
                  ))}
                </div>
              </div>

              {/* Cost Per Day Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>Show Cost Per Day</span>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>Display daily cost instead of monthly total</div>
                  </div>
                </div>
                <button
                  onClick={() => setCostPerDay(!costPerDay)}
                  style={{ width: 44, height: 24, borderRadius: 12, background: costPerDay ? 'var(--accent)' : 'var(--border)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s ease' }}
                >
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'white', position: 'absolute', top: 3, left: costPerDay ? 23 : 3, transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </button>
              </div>

              {/* Dashboard Layout */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
                    Dashboard Layout
                  </label>
                  <button
                    onClick={() => setDashboardOrder(['insights', 'summary', 'sla', 'costComparison', 'chartsRow', 'costBySub', 'costByEnv', 'costTiers', 'dailyTrends', 'optimization', 'waste', 'forecast', 'commitment', 'topology', 'tagAnalysis', 'riRecommendations', 'costAnomalies'])}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}
                  >
                    Reset
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[
                    { id: 'insights', label: 'Quick Insights' },
                    { id: 'summary', label: 'Summary Cards' },
                    { id: 'sla', label: 'VM Uptime (SLA)' },
                    { id: 'costComparison', label: 'Cost Comparison' },
                    { id: 'chartsRow', label: 'Charts Row' },
                    { id: 'costBySub', label: 'Cost by Subscription' },
                    { id: 'costByEnv', label: 'Cost by Environment' },
                    { id: 'costTiers', label: 'Cost Tiers' },
                    { id: 'dailyTrends', label: 'Daily Cost Trends' },
                    { id: 'optimization', label: 'Optimization' },
                    { id: 'waste', label: 'Waste Detection' },
                    { id: 'forecast', label: 'Cost Forecast' },
                    { id: 'commitment', label: 'Commitment Savings' },
                    { id: 'topology', label: 'Resource Topology' },
                    { id: 'tagAnalysis', label: 'Tag Analysis' },
                    { id: 'riRecommendations', label: 'RI Recommendations' },
                    { id: 'costAnomalies', label: 'Cost Anomalies' },
                  ].map(item => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDragItem(item.id)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverItem(item.id); }}
                      onDragEnd={() => { setDragItem(null); setDragOverItem(null); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragItem && dragItem !== item.id) {
                          setDashboardOrder(prev => {
                            const next = [...prev];
                            const from = next.indexOf(dragItem);
                            const to = next.indexOf(item.id);
                            next.splice(from, 1);
                            next.splice(to, 0, dragItem);
                            return next;
                          });
                        }
                        setDragItem(null);
                        setDragOverItem(null);
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: dragItem === item.id ? 'var(--accent-dim)' : dragOverItem === item.id ? 'var(--bg-surface)' : 'var(--bg-surface)', border: `1px solid ${dragOverItem === item.id ? 'var(--accent)' : 'var(--border)'}`, opacity: dragItem && dragItem !== item.id ? 0.6 : 1, cursor: 'grab', transition: 'all 0.15s ease' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" style={{ cursor: 'grab', flexShrink: 0 }}><path d="M5 9l4-4 4 4M5 15l4 4 4-4"/></svg>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-1)' }}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Anomaly Sensitivity */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Anomaly Sensitivity <span style={{ fontWeight: 400, textTransform: 'none' }}>(threshold multiplier)</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="0.5"
                    defaultValue="2"
                    onChange={e => localStorage.setItem('cloudviz-anomaly-threshold', e.target.value)}
                    style={{ flex: 1, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', minWidth: 36, textAlign: 'right' }}>2x</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Flag costs exceeding prior period by this multiple</div>
              </div>

              {/* Active Subscriptions */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Active Subscriptions
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {uniqueSubs.map(sub => (
                    <div key={sub} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      <span style={{ fontSize: 12, color: 'var(--text-1)', fontFamily: 'monospace' }}>{sub.slice(0, 8)}...</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '4px 0' }}>
                    {uniqueSubs.length} subscription{uniqueSubs.length !== 1 ? 's' : ''} active — costs shown are across all subscriptions
                  </div>
                </div>
              </div>

              {/* PII Masking */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Privacy & Exports
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setPiiMasking(v => !v)}>
                  <input type="checkbox" checked={piiMasking} onChange={() => {}} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent)' }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>Mask resource names in exports & UI</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Replace names with anonymous IDs for screenshots and shared reports</div>
                  </div>
                </div>
              </div>

              {/* Cache Control */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
                  Data Cache
                </label>
                <button
                  onClick={() => { fetch('http://localhost:8080/api/costs/cache', { method: 'DELETE' }); setTimeout(() => window.location.reload(), 500); }}
                  className="btn"
                  style={{ width: '100%', justifyContent: 'center', background: 'rgba(244 63 94 / 0.1)', color: 'var(--danger)', border: '1px solid rgba(244 63 94 / 0.2)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 6 6" /><path d="M19 6v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                  Clear Cost Cache & Reload
                </button>
              </div>

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

      {/* ── Keyboard Shortcuts Help Modal ── */}
      {showShortcutsHelp && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowShortcutsHelp(false)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M3 7h18M3 12h18M3 17h12" /><rect x="2" y="4" width="20" height="16" rx="2" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>Keyboard Shortcuts</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Power user shortcuts for quick navigation</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setShowShortcutsHelp(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { key: '⌘K / Ctrl+K', desc: 'Focus search input' },
                  { key: '⌘R / Ctrl+R', desc: 'Refresh page data' },
                  { key: '⌘E / Ctrl+E', desc: 'Export CSV' },
                  { key: '⌘D / Ctrl+D', desc: 'Toggle dark mode' },
                  { key: '⌘S / Ctrl+S', desc: 'Open settings' },
                  { key: '⌘1 / Ctrl+1', desc: 'Switch to Dashboard' },
                  { key: '⌘2 / Ctrl+2', desc: 'Switch to Resources' },
                  { key: '⌘3 / Ctrl+3', desc: 'Switch to Costs' },
                  { key: '⌘4 / Ctrl+4', desc: 'Switch to History' },
                  { key: '?', desc: 'Show this help dialog' },
                  { key: 'Esc', desc: 'Close modals/panels' },
                ].map((shortcut, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{shortcut.desc}</span>
                    <kbd style={{ padding: '4px 10px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-strong)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'monospace', minWidth: 100, textAlign: 'center' }}>
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                  <span>Shortcuts are disabled when typing in input fields</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Alert Modal ── */}
      {alertModal && alertModal.open && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setAlertModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: alertModal.icon === 'danger' ? 'var(--danger-dim)' : alertModal.icon === 'warning' ? 'rgba(245 158 11 / 0.1)' : 'var(--accent-dim)',
                  border: `1px solid ${alertModal.icon === 'danger' ? 'var(--danger)' : alertModal.icon === 'warning' ? 'rgba(245 158 11 / 0.2)' : 'var(--accent)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {alertModal.icon === 'danger' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h17.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
                  ) : alertModal.icon === 'warning' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h17.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--text-1)' }}>{alertModal.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{alertModal.message.split('\n')[0]}</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setAlertModal(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                {alertModal.message.split('\n').slice(1).join('\n')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                <button
                  onClick={() => setAlertModal(null)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: alertModal.icon === 'danger' ? 'var(--danger)' : alertModal.icon === 'warning' ? '#f59e0b' : 'var(--accent)',
                    color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  OK
                </button>
              </div>
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
