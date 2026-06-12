import { useState, useEffect, useCallback, useRef } from 'react';

// ─── useDebounce ──────────────────────────────────────────────────────────────

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// ─── useKeyboardShortcuts ─────────────────────────────────────────────────────

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[], enabled: boolean = true) {
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

// ─── useLocalStorage ──────────────────────────────────────────────────────────

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

// ─── useCountUp ───────────────────────────────────────────────────────────────

export function useCountUp(end: number, duration: number = 1000, startOnMount: boolean = true): number {
  const [count, setCount] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef(0);

  useEffect(() => {
    if (!startOnMount) return;

    startTimeRef.current = null;
    startValueRef.current = 0;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp;
      }

      const progress = Math.min((timestamp - startTimeRef.current) / duration, 1);
      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValueRef.current + (end - startValueRef.current) * easeOut);
      setCount(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [end, duration, startOnMount]);

  return count;
}

// ─── usePrevious ──────────────────────────────────────────────────────────────

export function usePrevious<T>(value: T): T | undefined {
  const [prevValue, setPrevValue] = useState<T | undefined>(undefined);
  const valueRef = useRef<T | undefined>(undefined);

  useEffect(() => {
    setPrevValue(valueRef.current);
    valueRef.current = value;
  }, [value]);

  return prevValue;
}

// ─── useClickOutside ───────────────────────────────────────────────────────────

export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: () => void
): void {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, handler]);
}

// ─── useMediaQuery ─────────────────────────────────────────────────────────────

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

// ─── useInterval ───────────────────────────────────────────────────────────────

export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const tick = () => savedCallback.current?.();
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}

// ─── useCachedFetch ─────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const globalCache = new Map<string, CacheEntry<unknown>>();

interface UseCachedFetchOptions {
  key: string;
  ttl?: number; // Time to live in milliseconds (default: 5 minutes)
  enabled?: boolean;
  onError?: (error: Error) => void;
}

export function useCachedFetch<T>(
  fetcher: () => Promise<T>,
  options: UseCachedFetchOptions
) {
  const { key, ttl = 5 * 60 * 1000, enabled = true, onError } = options;
  const [data, setData] = useState<T | null>(() => {
    const cached = globalCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data as T;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(!data && enabled);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      globalCache.set(key, { data: result, timestamp: Date.now(), ttl });
      setData(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [fetcher, key, ttl, onError]);

  useEffect(() => {
    if (!enabled) return;

    // Check cache first
    const cached = globalCache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      setData(cached.data as T);
      setIsLoading(false);
      return;
    }

    // Fetch if not cached or expired
    refetch();
  }, [key, enabled, refetch]);

  const invalidate = useCallback(() => {
    globalCache.delete(key);
    setData(null);
  }, [key]);

  return { data, isLoading, error, refetch, invalidate };
}

// Helper to invalidate specific cache entries
export function invalidateCache(keyPattern: string | RegExp): void {
  if (typeof keyPattern === 'string') {
    globalCache.delete(keyPattern);
  } else {
    for (const key of globalCache.keys()) {
      if (keyPattern.test(key)) {
        globalCache.delete(key);
      }
    }
  }
}

// Re-export domain-specific hooks
export { useResources } from './hooks/useResources';
export { useCosts } from './hooks/useCosts';
export { useSSECosts } from './hooks/useSSECosts';
export { useSelection } from './hooks/useSelection';
export { useFavorites } from './hooks/useFavorites';
export { useFilters } from './hooks/useFilters';
export { useSorting } from './hooks/useSorting';
export { usePagination } from './hooks/usePagination';
