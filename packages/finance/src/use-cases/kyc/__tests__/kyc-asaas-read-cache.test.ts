import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AsaasMyAccountDocumentsResponse, AsaasMyAccountStatus } from '@alusa/asaas';

const mockGetMyAccountStatus = vi.fn();
const mockGetMyAccountDocuments = vi.fn();

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    getMyAccountStatus: (...args: unknown[]) => mockGetMyAccountStatus(...args),
    getMyAccountDocuments: (...args: unknown[]) => mockGetMyAccountDocuments(...args),
  };
});

import {
  getKycAsaasReadCacheStats,
  getMyAccountDocumentsCached,
  getMyAccountStatusCached,
  invalidateKycAsaasReadCache,
  resetKycAsaasReadCacheStats,
} from '../kyc-asaas-read-cache';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CACHE_FLAG = process.env.ASAAS_KYC_READ_CACHE;

function makeStatus(overrides: Partial<AsaasMyAccountStatus> = {}): AsaasMyAccountStatus {
  return {
    general: 'PENDING',
    documentation: 'PENDING',
    bankAccountInfo: 'PENDING',
    ...overrides,
  };
}

function makeDocuments(overrides: Partial<AsaasMyAccountDocumentsResponse> = {}): AsaasMyAccountDocumentsResponse {
  return {
    data: [],
    ...overrides,
  };
}

describe('kyc-asaas-read-cache', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.ASAAS_KYC_READ_CACHE = 'true';
    vi.clearAllMocks();
    invalidateKycAsaasReadCache('key_1');
    invalidateKycAsaasReadCache('key_2');
    resetKycAsaasReadCacheStats();
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_CACHE_FLAG === undefined) {
      delete process.env.ASAAS_KYC_READ_CACHE;
    } else {
      process.env.ASAAS_KYC_READ_CACHE = ORIGINAL_CACHE_FLAG;
    }
  });

  it('deduplica reads concorrentes de status para a mesma conta Asaas', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus({ general: 'APPROVED' }));

    const [first, second] = await Promise.all([
      getMyAccountStatusCached({ apiKey: 'key_1' }),
      getMyAccountStatusCached({ apiKey: 'key_1' }),
    ]);

    expect(mockGetMyAccountStatus).toHaveBeenCalledTimes(1);
    expect(first.general).toBe('APPROVED');
    expect(second.general).toBe('APPROVED');
    expect(getKycAsaasReadCacheStats()).toMatchObject({
      status: { hits: 0, misses: 2, forceRefreshes: 0 },
    });
  });

  it('reaproveita documents em cache curto e faz bypass com forceRefresh', async () => {
    mockGetMyAccountDocuments
      .mockResolvedValueOnce(makeDocuments({ data: [{ id: 'grp_1', status: 'NOT_SENT' }] as never }))
      .mockResolvedValueOnce(makeDocuments({ data: [{ id: 'grp_2', status: 'APPROVED' }] as never }));

    const cached = await getMyAccountDocumentsCached({ apiKey: 'key_1' });
    const reused = await getMyAccountDocumentsCached({ apiKey: 'key_1' });
    const fresh = await getMyAccountDocumentsCached({ apiKey: 'key_1' }, { forceRefresh: true });

    expect(mockGetMyAccountDocuments).toHaveBeenCalledTimes(2);
    expect(cached.data[0]?.id).toBe('grp_1');
    expect(reused.data[0]?.id).toBe('grp_1');
    expect(fresh.data[0]?.id).toBe('grp_2');
    expect(getKycAsaasReadCacheStats()).toMatchObject({
      documents: { hits: 1, misses: 1, forceRefreshes: 1 },
    });
  });

  it('invalida cache por apiKey sem afetar outra conta', async () => {
    mockGetMyAccountStatus
      .mockResolvedValueOnce(makeStatus({ general: 'APPROVED' }))
      .mockResolvedValueOnce(makeStatus({ general: 'REJECTED' }))
      .mockResolvedValueOnce(makeStatus({ general: 'PENDING' }));

    await getMyAccountStatusCached({ apiKey: 'key_1' });
    await getMyAccountStatusCached({ apiKey: 'key_2' });

    invalidateKycAsaasReadCache('key_1');

    await getMyAccountStatusCached({ apiKey: 'key_1' });
    await getMyAccountStatusCached({ apiKey: 'key_2' });

    expect(mockGetMyAccountStatus).toHaveBeenCalledTimes(3);
    expect(getKycAsaasReadCacheStats()).toMatchObject({
      status: { hits: 1, misses: 3, forceRefreshes: 0 },
      invalidations: 1,
    });
  });
});
