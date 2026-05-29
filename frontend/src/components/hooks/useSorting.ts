import { useState, useCallback, useMemo } from 'react';
import type { SortConfig } from '../types';

interface UseSortingOptions<T> {
  initialSort?: SortConfig;
  data?: T[];
}

export function useSorting<T>(options: UseSortingOptions<T> = {}) {
  const { initialSort = { key: '', direction: 'asc' }, data = [] } = options;

  const [sortConfig, setSortConfig] = useState<SortConfig>(initialSort);

  const handleSort = useCallback((key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  }, []);

  const sortedData = useMemo(() => {
    const key = sortConfig.key;
    if (!key || data.length === 0) return data;

    return [...data].sort((a, b) => {
      const aVal = (a as any)[key];
      const bVal = (b as any)[key];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortConfig.direction === 'asc' ? -1 : 1;
      if (bVal == null) return sortConfig.direction === 'asc' ? 1 : -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc'
          ? aVal - bVal
          : bVal - aVal;
      }

      return 0;
    });
  }, [data, sortConfig]);

  const resetSort = useCallback(() => {
    setSortConfig({ key: '', direction: 'asc' });
  }, []);

  return {
    sortConfig,
    setSortConfig,
    handleSort,
    sortedData,
    resetSort
  };
}
