import { useState, useCallback, useMemo } from 'react';

interface UseFiltersOptions {
  initialFilters?: {
    regions?: string[];
    subscriptions?: string[];
    resourceGroups?: string[];
    types?: string;
    creators?: string[];
  };
}

export function useFilters(options: UseFiltersOptions = {}) {
  const { initialFilters = {} } = options;

  const [regionFilter, setRegionFilter] = useState<string[]>(initialFilters.regions || []);
  const [subFilter, setSubFilter] = useState<string[]>(initialFilters.subscriptions || []);
  const [rgFilter, setRgFilter] = useState<string[]>(initialFilters.resourceGroups || []);
  const [typeFilter, setTypeFilter] = useState<string>(initialFilters.types || '');
  const [creatorFilter, setCreatorFilter] = useState<string[]>(initialFilters.creators || []);

  // Quick filters
  const [showOrphanedOnly, setShowOrphanedOnly] = useState(false);
  const [showUnattachedDiskOnly, setShowUnattachedDiskOnly] = useState(false);
  const [showUnassignedPIPOnly, setShowUnassignedPIPOnly] = useState(false);
  const [showUnattachedNICOnly, setShowUnattachedNICOnly] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const hasFilters = useMemo(() => (
    regionFilter.length > 0 ||
    subFilter.length > 0 ||
    rgFilter.length > 0 ||
    typeFilter !== '' ||
    creatorFilter.length > 0 ||
    showOrphanedOnly ||
    showUnattachedDiskOnly ||
    showUnassignedPIPOnly ||
    showUnattachedNICOnly ||
    showFavoritesOnly
  ), [regionFilter, subFilter, rgFilter, typeFilter, creatorFilter, showOrphanedOnly, showUnattachedDiskOnly, showUnassignedPIPOnly, showUnattachedNICOnly, showFavoritesOnly]);

  const clearFilters = useCallback(() => {
    setRegionFilter([]);
    setSubFilter([]);
    setRgFilter([]);
    setTypeFilter('');
    setCreatorFilter([]);
    setShowOrphanedOnly(false);
    setShowUnattachedDiskOnly(false);
    setShowUnassignedPIPOnly(false);
    setShowUnattachedNICOnly(false);
    setShowFavoritesOnly(false);
  }, []);

  const clearQuickFilters = useCallback(() => {
    setShowOrphanedOnly(false);
    setShowUnattachedDiskOnly(false);
    setShowUnassignedPIPOnly(false);
    setShowUnattachedNICOnly(false);
    setShowFavoritesOnly(false);
  }, []);

  return {
    // Filters
    regionFilter,
    setRegionFilter,
    subFilter,
    setSubFilter,
    rgFilter,
    setRgFilter,
    typeFilter,
    setTypeFilter,
    creatorFilter,
    setCreatorFilter,

    // Quick filters
    showOrphanedOnly,
    setShowOrphanedOnly,
    showUnattachedDiskOnly,
    setShowUnattachedDiskOnly,
    showUnassignedPIPOnly,
    setShowUnassignedPIPOnly,
    showUnattachedNICOnly,
    setShowUnattachedNICOnly,
    showFavoritesOnly,
    setShowFavoritesOnly,

    // Helpers
    hasFilters,
    clearFilters,
    clearQuickFilters
  };
}
