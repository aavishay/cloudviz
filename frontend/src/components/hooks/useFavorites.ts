import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'cloudviz:favorites';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(favorites)));
    } catch (err) {
      console.error('Failed to save favorites:', err);
    }
  }, [favorites]);

  const toggleFavorite = useCallback((resourceId: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      return next;
    });
  }, []);

  const isFavorite = useCallback((resourceId: string) => {
    return favorites.has(resourceId);
  }, [favorites]);

  const addFavorite = useCallback((resourceId: string) => {
    setFavorites(prev => new Set([...prev, resourceId]));
  }, []);

  const removeFavorite = useCallback((resourceId: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      next.delete(resourceId);
      return next;
    });
  }, []);

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    addFavorite,
    removeFavorite
  };
}
