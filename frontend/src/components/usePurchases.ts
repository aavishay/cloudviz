// ─── usePurchases ───────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { useCachedFetch } from './hooks';

export type PurchaseKind = 'marketplace' | 'commitments';

// usePurchases loads /api/costs/{kind} for the active subscriptions and a persisted period
// (days), cached for 15 minutes per period and subscription set.
export function usePurchases(kind: PurchaseKind, defaultPeriod: number, activeSubs: string[], enabled: boolean) {
  const storageKey = `cloudviz-${kind}Period`;
  const [period, setPeriod] = useState(() => parseInt(localStorage.getItem(storageKey) || String(defaultPeriod), 10));
  useEffect(() => { localStorage.setItem(storageKey, String(period)); }, [storageKey, period]);

  const key = useMemo(() => `${kind}-${period}-${[...activeSubs].sort().join(',')}`, [kind, period, activeSubs]);
  const { data, isLoading, error, refetch } = useCachedFetch(
    async () => {
      if (activeSubs.length === 0) return null;
      const params = new URLSearchParams();
      activeSubs.forEach(s => params.append('subscriptionId', s));
      params.append('period', String(period));
      const res = await fetch(`/api/costs/${kind}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    },
    { key, ttl: 15 * 60 * 1000, enabled: enabled && activeSubs.length > 0 },
  );

  return {
    data,
    loading: isLoading,
    error: error ? `Failed to load ${kind} data. Please try again.` : null,
    period,
    setPeriod,
    refetch: () => { refetch(); },
  };
}
