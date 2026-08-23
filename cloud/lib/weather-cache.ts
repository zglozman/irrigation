// TTL cache helper for weather and other data

interface CacheEntry<T> {
  value: T;
  expireAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

/**
 * Cached async function with TTL
 * @param key - Cache key
 * @param ttlMs - Time to live in milliseconds
 * @param fn - Async function to cache
 * @returns Cached or fresh result
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;

  if (entry && entry.expireAt > now) {
    return entry.value;
  }

  const value = await fn();
  cache.set(key, {
    value,
    expireAt: now + ttlMs,
  });

  return value;
}

/**
 * Invalidate a cache entry
 * @param key - Cache key to delete
 */
export function cacheDelete(key: string): void {
  cache.delete(key);
}
