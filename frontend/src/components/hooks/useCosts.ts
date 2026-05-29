import { useState, useEffect, useCallback, useRef } from 'react';
import type { CostPrediction } from '../types';

interface UseCostsOptions {
  baseUrl?: string;
}

export function useCosts(options: UseCostsOptions = {}) {
  const { baseUrl = '' } = options;
  const [costs, setCosts] = useState<CostPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchCosts = useCallback(async (forceAll = false, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/costs${forceAll ? '?force=true' : ''}`, { signal });
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data = await res.json();
      setCosts(data.costs || []);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Failed to fetch costs:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const refreshCosts = useCallback(async (forceAll = false) => {
    await fetchCosts(forceAll);
  }, [fetchCosts]);

  const totalCost = costs.reduce((sum, c) => sum + (c.cost || 0), 0);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    fetchCosts(false, abortControllerRef.current.signal);
    return () => abortControllerRef.current?.abort();
  }, [fetchCosts]);

  return {
    costs,
    loading,
    error,
    totalCost,
    fetchCosts,
    refreshCosts,
    setCosts
  };
}
