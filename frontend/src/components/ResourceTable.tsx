import { useState, useEffect, useRef, useMemo } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { ScoreRing } from './ScoreRing';
import { EmptyState, friendlyType } from './utils';
import type { AzureResource, SortConfig } from './types';

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
  { key: 'subscriptionId', label: 'Subscription',  defaultW: 120, minWidth: 80 },
  { key: 'optimization',   label: 'Efficiency',         defaultW: 70, minWidth: 50 },
  { key: 'createdBy',      label: 'Created By',     defaultW: 100, minWidth: 60 },
  { key: 'cost',           label: 'Cost',          defaultW: 80, minWidth: 60 },
];

export function ResourceTable({ resources, sortConfig, onSort, onLocationClick, onRgClick, onSubClick, onTypeClick, onResourceClick, favorites, onToggleFavorite, selected, onSelect, onSelectAll, onBulkExport }: ResourceTableProps) {
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
          <button onClick={() => onSubClick(r.subscriptionId)} title={`${r.subscriptionName || r.subscriptionId}\n(ID: ${r.subscriptionId})`} className="cell-truncate" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--text-2)', width: '100%', textAlign: 'left' }}>
            {r.subscriptionName || r.subscriptionId}
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
        <div style={{ width: widths.createdBy, flexShrink: 0, padding: '0 14px', minWidth: 0 }}>
          {r.createdBy ? (
            <span title={`Created by: ${r.createdBy}`} style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
              {r.createdBy.includes('@') ? r.createdBy.split('@')[0] : r.createdBy}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Unknown</span>
          )}
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
  const MIN_LIST_HEIGHT = 300;

  // Calculate dynamic list height based on viewport
  const [listHeight, setListHeight] = useState(540);

  useEffect(() => {
    const calculateHeight = () => {
      // Get available height: viewport - header (64px) - filters area (~76px) - padding/margins
      const headerHeight = 64; // --header-h
      const filtersHeight = 60; // Approximate filters height
      const marginsAndPadding = 80; // Additional margins and padding
      const availableHeight = window.innerHeight - headerHeight - filtersHeight - marginsAndPadding;
      setListHeight(Math.max(MIN_LIST_HEIGHT, availableHeight));
    };

    calculateHeight();
    window.addEventListener('resize', calculateHeight);
    return () => window.removeEventListener('resize', calculateHeight);
  }, []);

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
      <div ref={wrapRef} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', overflow: 'hidden', height: listHeight }}>
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
            height={listHeight - HEADER_HEIGHT}
            itemCount={resources.length}
            itemSize={48}
            itemData={itemData}
            width={listWidth}
            className="resource-table-virtual-list"
          >
            {Row}
          </FixedSizeList>
        ) : resources.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: listHeight - HEADER_HEIGHT }}>
            <EmptyState icon={<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>} message="No resources matched your criteria" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
