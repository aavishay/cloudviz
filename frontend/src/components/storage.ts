// ─── Persisted settings ─────────────────────────────────────────────────────────

// parseStored parses a JSON value read from localStorage, returning fallback when it is
// missing or corrupt. A bad value used to throw during App's first render, and the error
// boundary's reload hit the same value again, so the app never started.
export function parseStored<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
