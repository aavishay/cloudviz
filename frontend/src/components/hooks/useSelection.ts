import { useState, useCallback } from 'react';

interface UseSelectionOptions {
  maxSelection?: number;
}

export function useSelection(options: UseSelectionOptions = {}) {
  const { maxSelection } = options;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelection = useCallback((id: string, isSelected: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (isSelected) {
        if (maxSelection && next.size >= maxSelection) {
          return prev;
        }
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, [maxSelection]);

  const selectAll = useCallback((ids: string[], isSelected: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (isSelected) {
        ids.forEach(id => {
          if (!maxSelection || next.size < maxSelection) {
            next.add(id);
          }
        });
      } else {
        ids.forEach(id => next.delete(id));
      }
      return next;
    });
  }, [maxSelection]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback((id: string) => {
    return selected.has(id);
  }, [selected]);

  const selectedCount = selected.size;
  const hasSelection = selectedCount > 0;

  return {
    selected,
    setSelected,
    toggleSelection,
    selectAll,
    clearSelection,
    isSelected,
    selectedCount,
    hasSelection
  };
}
