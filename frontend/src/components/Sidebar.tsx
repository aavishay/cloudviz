import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { friendlyType } from './utils';

// ─── Portal ───────────────────────────────────────────────────────────────────

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return mounted ? createPortal(children, document.body) : null;
}

// ─── ChevronIcon ──────────────────────────────────────────────────────────────

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-3)', flexShrink: 0 }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

// ─── FilterDropdown (multi) ───────────────────────────────────────────────────

interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  formatLabel?: (v: string) => string;
}

function FilterDropdown({ label, options, selected, onToggle, formatLabel }: FilterDropdownProps) {
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

  const filtered = options.filter(o => {
    const searchTarget = formatLabel ? formatLabel(o) : o;
    return searchTarget.toLowerCase().includes(search.toLowerCase());
  });
  const hasValue = selected.length > 0;

  // Use state for dropdown position to avoid ref access during render
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 220 });

  useLayoutEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 220),
      });
    }
  }, [open]);

  const dropdownStyle = {
    position: 'fixed' as const,
    top: dropdownPos.top,
    left: dropdownPos.left,
    width: dropdownPos.width,
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
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatLabel ? formatLabel(o) : o}</span>
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

interface SingleFilterDropdownProps {
  label: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  getLabel?: (v: string) => string;
}

function SingleFilterDropdown({ label, options, selected, onSelect, getLabel }: SingleFilterDropdownProps) {
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

// ─── Sidebar Component ──────────────────────────────────────────────────────────

export interface SidebarProps {
  open: boolean;
  onClose: () => void;
  uniqueRegions: string[];
  uniqueSubs: string[];
  uniqueRGs: string[];
  uniqueTypes: string[];
  uniqueCreators: string[];
  regionFilter: string[];
  subFilter: string[];
  rgFilter: string[];
  typeFilter: string;
  creatorFilter: string[];
  showOrphanedOnly: boolean;
  showUnattachedDiskOnly: boolean;
  showUnassignedPIPOnly: boolean;
  showUnattachedNICOnly: boolean;
  showFavoritesOnly: boolean;
  favorites: Set<string>;
  subNameMap: Map<string, string>;
  setRegionFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setSubFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setRgFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setTypeFilter: React.Dispatch<React.SetStateAction<string>>;
  setCreatorFilter: React.Dispatch<React.SetStateAction<string[]>>;
  setShowOrphanedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUnattachedDiskOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUnassignedPIPOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUnattachedNICOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFavoritesOnly: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  open, onClose, uniqueRegions, uniqueSubs, uniqueRGs, uniqueTypes, uniqueCreators,
  regionFilter, subFilter, rgFilter, typeFilter, creatorFilter,
  showOrphanedOnly, showUnattachedDiskOnly, showUnassignedPIPOnly, showUnattachedNICOnly, showFavoritesOnly,
  setRegionFilter, setSubFilter, setRgFilter, setTypeFilter, setCreatorFilter,
  setShowOrphanedOnly, setShowUnattachedDiskOnly, setShowUnassignedPIPOnly, setShowUnattachedNICOnly, setShowFavoritesOnly,
  setCurrentPage, collapsed, onToggleCollapse, favorites, subNameMap
}: SidebarProps) {
  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (val: string) => {
    setter(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
    setCurrentPage(1);
  };

  const hasFilters = regionFilter.length || subFilter.length || rgFilter.length || typeFilter || creatorFilter.length || showOrphanedOnly || showUnattachedDiskOnly || showUnassignedPIPOnly || showUnattachedNICOnly || showFavoritesOnly;

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
                  <button onClick={() => { setRegionFilter([]); setSubFilter([]); setRgFilter([]); setTypeFilter(''); setCreatorFilter([]); setShowOrphanedOnly(false); setShowUnattachedDiskOnly(false); setShowUnassignedPIPOnly(false); setShowUnattachedNICOnly(false); setShowFavoritesOnly(false); setCurrentPage(1); }}
                    style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', transition: 'opacity 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    Clear all
                  </button>
                ) : null}
              </div>

              <FilterDropdown label="Region" options={uniqueRegions} selected={regionFilter} onToggle={toggle(setRegionFilter)} />
              <FilterDropdown label="Subscription" options={uniqueSubs} selected={subFilter} onToggle={toggle(setSubFilter)} formatLabel={id => subNameMap.get(id) || id} />
              <FilterDropdown label="Resource Group" options={uniqueRGs} selected={rgFilter} onToggle={toggle(setRgFilter)} />
              <SingleFilterDropdown label="Resource Type" options={uniqueTypes} selected={typeFilter}
                onSelect={v => { setTypeFilter(v); setCurrentPage(1); }} getLabel={friendlyType} />
              <FilterDropdown label="Created By" options={uniqueCreators} selected={creatorFilter}
                onToggle={toggle(setCreatorFilter)} formatLabel={v => v.includes('@') ? v.split('@')[0] : v} />

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

export default Sidebar;
