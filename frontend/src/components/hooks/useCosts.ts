import { useState, useEffect, useCallback, useRef } from 'react';
import type { CostPrediction, CostItem } from '../types';

interface UseCostsOptions {
  baseUrl?: string;
  debounceMs?: number;
}

interface CostResponse {
  data?: CostItem[];
  costs?: CostPrediction[];
  totalCost?: number;
}

export function useCosts(options: UseCostsOptions = {}) {
  const { baseUrl = '', debounceMs = 300 } = options;
  const [costs, setCosts] = useState<CostPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCachedData, setHasCachedData] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchTimeRef = useRef<number>(0);

  // Abort any pending request
  const abortPendingRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const fetchCosts = useCallback(async (
    forceAll = false,
    signal?: AbortSignal,
    useProgressive = true
  ): Promise<CostResponse | null> => {
    // Don't fetch if we fetched recently (within 5 seconds) unless forced
    const now = Date.now();
    if (!forceAll && now - lastFetchTimeRef.current < 5000) {
      return null;
    }
    lastFetchTimeRef.current = now;

    setLoading(true);

    try {
      // First, try to get cached data for progressive loading
      if (useProgressive && !forceAll) {
        const cachedRes = await fetch(`${baseUrl}/api/costs?cached=true`, { signal });
        if (cachedRes.ok) {
          const cachedData = await cachedRes.json();
          if (cachedData.costs?.length > 0 || cachedData.data?.length > 0) {
            const costItems = cachedData.costs || cachedData.data || [];
            setCosts(costItems);
            setHasCachedData(true);
            setLoading(false); // Show cached data immediately
          }
        }
      }

      // Then fetch fresh data
      const res = await fetch(`${baseUrl}/api/costs${forceAll ? '?force=true' : ''}`, { signal });
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data: CostResponse = await res.json();
      const costItems = data.costs || data.data || [];
      // Map CostItem to CostPrediction if needed
      const mappedCosts: CostPrediction[] = costItems.map((item: any) => ({
        cost: item.cost || 0,
        resourceId: item.resourceId || item.id,
        resourceGroup: item.resourceGroup,
        resourceType: item.resourceType,
        resourceLocation: item.resourceLocation,
        subscriptionId: item.subscriptionId || ''
      }));
      setCosts(mappedCosts);
      setError(null);
      setHasCachedData(false);
      return data;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return null;
      }
      console.error('Failed to fetch costs:', err);
      // Only show error if we don't have cached data
      if (!hasCachedData) {
        setError((err as Error).message);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [baseUrl, hasCachedData]);

  // Debounced fetch function
  const fetchCostsDebounced = useCallback((forceAll = false, useProgressive = true) => {
    abortPendingRequest();

    debounceTimerRef.current = setTimeout(() => {
      abortControllerRef.current = new AbortController();
      fetchCosts(forceAll, abortControllerRef.current.signal, useProgressive);
    }, debounceMs);
  }, [fetchCosts, debounceMs, abortPendingRequest]);

  const refreshCosts = useCallback(async (forceAll = false) => {
    abortPendingRequest();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return fetchCosts(forceAll, controller.signal, false);
  }, [fetchCosts, abortPendingRequest]);

  const totalCost = costs.reduce((sum, c) => sum + (c.cost || 0), 0);

  // Initial fetch with cancellation support
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Use debounced fetch on mount
    debounceTimerRef.current = setTimeout(() => {
      fetchCosts(false, controller.signal, true);
    }, 100); // Small initial delay

    return () => {
      abortPendingRequest();
    };
  }, [fetchCosts, abortPendingRequest]);

  return {
    costs,
    loading,
    error,
    totalCost,
    hasCachedData,
    fetchCosts: fetchCostsDebounced,
    refreshCosts,
    setCosts,
    abortPendingRequest
  };
}
