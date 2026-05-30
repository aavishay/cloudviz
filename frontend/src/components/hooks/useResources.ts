import { useState, useEffect, useCallback, useRef } from 'react';
import type { AzureResource } from '../types';

interface UseResourcesOptions {
  baseUrl?: string;
  debounceMs?: number;
}

interface ResourcesResponse {
  data?: AzureResource[];
  resources?: AzureResource[];
  totalCost?: number;
  total?: number;
}

export function useResources(options: UseResourcesOptions = {}) {
  const { baseUrl = '', debounceMs = 300 } = options;
  const [resources, setResources] = useState<AzureResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
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

  const fetchResources = useCallback(async (
    filters?: Record<string, string | string[]>,
    signal?: AbortSignal,
    useProgressive = true
  ): Promise<ResourcesResponse | null> => {
    // Don't fetch if we fetched recently (within 3 seconds) unless forced
    const now = Date.now();
    if (!filters && now - lastFetchTimeRef.current < 3000) {
      return null;
    }
    lastFetchTimeRef.current = now;

    setLoading(true);

    try {
      // Build query params
      const params = new URLSearchParams();
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach(v => params.append(key, v));
          } else if (value) {
            params.append(key, value);
          }
        });
      }

      const queryString = params.toString();
      const url = `${baseUrl}/api/resources${queryString ? `?${queryString}` : ''}`;

      // For progressive loading, first show any cached/stale data quickly
      if (useProgressive && !filters) {
        try {
          const cachedRes = await fetch(url, {
            signal,
            headers: { 'X-Use-Cache': 'true' }
          });
          if (cachedRes.ok) {
            const cachedData: ResourcesResponse = await cachedRes.json();
            const cachedResources = cachedData.data || cachedData.resources || [];
            if (cachedResources.length > 0) {
              setResources(cachedResources);
              setTotalCount(cachedData.total || cachedResources.length);
              setHasCachedData(true);
              setLoading(false); // Show cached data immediately
            }
          }
        } catch {
          // Ignore cache fetch errors
        }
      }

      // Fetch fresh data
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

      const data: ResourcesResponse = await res.json();
      const fetchedResources = data.data || data.resources || [];

      setResources(fetchedResources);
      setTotalCount(data.total || fetchedResources.length);
      setError(null);
      setHasCachedData(false);

      return data;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return null;
      }
      console.error('Failed to load resources:', err);
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
  const fetchResourcesDebounced = useCallback((filters?: Record<string, string | string[]>) => {
    abortPendingRequest();

    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      fetchResources(filters, controller.signal, true);
    }, debounceMs);
  }, [fetchResources, debounceMs, abortPendingRequest]);

  const refreshResources = useCallback(async (filters?: Record<string, string | string[]>) => {
    abortPendingRequest();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return fetchResources(filters, controller.signal, false);
  }, [fetchResources, abortPendingRequest]);

  // Initial fetch with debounce
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Use debounced fetch on mount
    debounceTimerRef.current = setTimeout(() => {
      fetchResources(undefined, controller.signal, true);
    }, 100);

    return () => {
      abortPendingRequest();
    };
  }, [fetchResources, abortPendingRequest]);

  return {
    resources,
    setResources,
    loading,
    error,
    totalCount,
    hasCachedData,
    fetchResources: fetchResourcesDebounced,
    refreshResources,
    abortPendingRequest
  };
}
