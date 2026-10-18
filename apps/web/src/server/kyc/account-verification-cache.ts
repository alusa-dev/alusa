import { PrivateMemoryCache, privateCacheControl } from '@/lib/private-cache';

const verificationCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 10,
  staleWhileRevalidateSeconds: 0,
});

export const accountVerificationCacheControl = privateCacheControl({
  maxAgeSeconds: 10,
  staleWhileRevalidateSeconds: 0,
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
