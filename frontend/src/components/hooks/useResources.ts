import { useState, useEffect, useCallback, useRef } from 'react';
import type { AzureResource } from '../types';

interface UseResourcesOptions {
  baseUrl?: string;
}

export function useResources(options: UseResourcesOptions = {}) {
  const { baseUrl = '' } = options;
  const [resources, setResources] = useState<AzureResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchResources = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${baseUrl}/api/resources`, { signal });
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data = await res.json();
      setResources(data.resources || []);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('Failed to load resources:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const refreshResources = useCallback(async () => {
    setLoading(true);
    await fetchResources();
  }, [fetchResources]);

  useEffect(() => {
    abortControllerRef.current = new AbortController();
    fetchResources(abortControllerRef.current.signal);
    return () => abortControllerRef.current?.abort();
  }, [fetchResources]);

  return {
    resources,
    setResources,
    loading,
    error,
    fetchResources,
    refreshResources
  };
}
