import { createHash } from 'node:crypto';

import {
  getMyAccountDocuments,
  getMyAccountStatus,
  type AsaasMyAccountDocumentsResponse,
  type AsaasMyAccountStatus,
} from '@alusa/asaas';
import { recordAsaasReadIntent, type AsaasReadIntent } from '../../foundation/asaas-read-intent';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export type KycAsaasReadCacheOptions = {
  forceRefresh?: boolean;
  intent?: AsaasReadIntent;
};

export type KycAsaasReadCacheStats = {
  status: {
    hits: number;
    misses: number;
    forceRefreshes: number;
  };
  documents: {
    hits: number;
    misses: number;
    forceRefreshes: number;
  };
  invalidations: number;
};

const KYC_READ_CACHE_TTL_MS = 10_000;
const readCache = new Map<string, CacheEntry<unknown>>();
const readInFlight = new Map<string, Promise<unknown>>();
const stats: KycAsaasReadCacheStats = {
  status: { hits: 0, misses: 0, forceRefreshes: 0 },
  documents: { hits: 0, misses: 0, forceRefreshes: 0 },
  invalidations: 0,
};

function statsBucket(key: string): keyof Omit<KycAsaasReadCacheStats, 'invalidations'> {
  return key.includes(':documents:') ? 'documents' : 'status';
}

function isKycReadCacheEnabled(): boolean {
  if (process.env.ASAAS_KYC_READ_CACHE === 'true') return true;
  return process.env.NODE_ENV !== 'test' && process.env.ASAAS_KYC_READ_CACHE !== 'false';
}

function buildCacheKey(apiKey: string, scope: 'status' | 'documents'): string {
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  return `kyc:${scope}:${keyHash}`;
}

function getCachedValue<T>(key: string): T | null {
  if (!isKycReadCacheEnabled()) return null;

  const entry = readCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    readCache.delete(key);
    return null;
  }

  return entry.value as T;
}

function setCachedValue<T>(key: string, value: T): void {
  if (!isKycReadCacheEnabled()) return;

  readCache.set(key, {
    value,
    expiresAt: Date.now() + KYC_READ_CACHE_TTL_MS,
  });
}

async function withReadCache<T>(
  key: string,
  loader: () => Promise<T>,
  opts: KycAsaasReadCacheOptions = {},
): Promise<T> {
  if (!isKycReadCacheEnabled()) {
    if (opts.intent) recordAsaasReadIntent(opts.intent);
    return loader();
  }

  if (opts.forceRefresh) {
    stats[statsBucket(key)].forceRefreshes += 1;
    readCache.delete(key);
    if (opts.intent) recordAsaasReadIntent(opts.intent);
    // Deduplicate concurrent forceRefresh calls: if a refresh for this key
    // is already in-flight, return the same promise instead of issuing
    // another request to the provider (protects against parallel fresh=1 calls).
    const existingRefresh = readInFlight.get(key);
    if (existingRefresh) {
      return existingRefresh as Promise<T>;
    }

    const refreshRequest = loader()
      .then((value) => {
        setCachedValue(key, value);
        return value;
      })
      .finally(() => {
        readInFlight.delete(key);
      });

    readInFlight.set(key, refreshRequest as Promise<unknown>);
    return refreshRequest;
  }

  const cached = getCachedValue<T>(key);
  if (cached) {
    stats[statsBucket(key)].hits += 1;
    return cached;
  }

  stats[statsBucket(key)].misses += 1;

  const existing = readInFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const request = loader()
    .then((value) => {
      setCachedValue(key, value);
      return value;
    })
    .finally(() => {
      readInFlight.delete(key);
    });

  readInFlight.set(key, request as Promise<unknown>);
  if (opts.intent) recordAsaasReadIntent(opts.intent);
  return request;
}

export function invalidateKycAsaasReadCache(apiKey: string): void {
  if (!isKycReadCacheEnabled()) return;

  let deletedEntries = 0;
  const prefixes = [
    buildCacheKey(apiKey, 'status'),
    buildCacheKey(apiKey, 'documents'),
  ];

  for (const key of [...readCache.keys()]) {
    if (prefixes.includes(key)) {
      readCache.delete(key);
      deletedEntries += 1;
    }
  }

  if (deletedEntries > 0) {
    stats.invalidations += 1;
  }
}

export function getKycAsaasReadCacheStats(): KycAsaasReadCacheStats {
  return {
    status: { ...stats.status },
    documents: { ...stats.documents },
    invalidations: stats.invalidations,
  };
}

export function resetKycAsaasReadCacheStats(): void {
  stats.status.hits = 0;
  stats.status.misses = 0;
  stats.status.forceRefreshes = 0;
  stats.documents.hits = 0;
  stats.documents.misses = 0;
  stats.documents.forceRefreshes = 0;
  stats.invalidations = 0;
}

export function getMyAccountStatusCached(
  params: { apiKey: string },
  opts: KycAsaasReadCacheOptions = {},
): Promise<AsaasMyAccountStatus> {
  return withReadCache(
    buildCacheKey(params.apiKey, 'status'),
    () => getMyAccountStatus({ apiKey: params.apiKey }),
    opts,
  );
}

export function getMyAccountDocumentsCached(
  params: { apiKey: string },
  opts: KycAsaasReadCacheOptions = {},
): Promise<AsaasMyAccountDocumentsResponse> {
  return withReadCache(
    buildCacheKey(params.apiKey, 'documents'),
    () => getMyAccountDocuments({ apiKey: params.apiKey }),
    opts,
  );
}
