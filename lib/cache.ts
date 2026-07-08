// Jednoduchý in-memory cache s TTL — rovnaký princíp ako cachovanie OAuth tokenov
// (lib/shopify/token.ts, lib/zakeke/token.ts): žije len v pamäti bežiacej serverless
// funkcie, zdieľaný medzi requestmi len pokiaľ Vercel opätovne použije tú istú "teplú"
// inštanciu. Pre MVP je to dostatočné a lacné zrýchlenie bez potreby externého úložiska.

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export const DEFAULT_TTL_MS = 3 * 60 * 1000;

export async function getOrSetCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const cached = store.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const value = await fetcher();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
