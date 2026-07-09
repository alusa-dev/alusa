import { PrivateMemoryCache, privateCacheControl } from '@/lib/private-cache';

const verificationCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});

export const accountVerificationCacheControl = privateCacheControl({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});

export function getAccountVerificationCache(contaId: string) {
  return verificationCache.get(contaId);
}

export function setAccountVerificationCache(contaId: string, body: unknown) {
  verificationCache.set(contaId, body);
}

export function invalidateAccountVerificationCache(contaId: string) {
  verificationCache.delete(contaId);
}
