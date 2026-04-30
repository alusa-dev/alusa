import { describe, it, expect } from 'vitest';
import type { AsaasMyAccountDocumentsResponse, AsaasMyAccountStatus } from '@alusa/asaas';
import { isCacheV2, buildCacheV2, buildWebhookCacheV2, expandCacheV2Documents } from '../kyc-cache-utils';

// ── Fixtures ──────────────────────────────────────────────────────────────

const fakeStatus: AsaasMyAccountStatus = {
  general: 'PENDING',
  documentation: 'APPROVED',
  bankAccountInfo: 'NOT_SENT',
};

const fakeDocuments: AsaasMyAccountDocumentsResponse = {
  data: [
    {
      id: 'grp_1',
      status: 'NOT_SENT',
      type: 'IDENTIFICATION',
      title: 'RG ou CNH',
      description: 'Envie frente e verso',
      onboardingUrl: 'https://asaas.com/onboarding/xyz',
      documents: [{ id: 'doc_1', status: 'NOT_SENT', type: 'IDENTIFICATION' }],
    },
    {
      id: 'grp_2',
      status: 'APPROVED',
      type: 'SOCIAL_CONTRACT',
      title: 'Contrato social',
      documents: [],
    },
  ],
  rejectReasons: ['Documento ilegível'],
};

// ── isCacheV2 ─────────────────────────────────────────────────────────────

describe('isCacheV2', () => {
  it('retorna true para objeto com version === 2', () => {
    expect(isCacheV2({ version: 2 })).toBe(true);
  });

  it('retorna false para version !== 2', () => {
    expect(isCacheV2({ version: 1 })).toBe(false);
    expect(isCacheV2({ version: 3 })).toBe(false);
  });

  it('retorna false para null/undefined/primitivos', () => {
    expect(isCacheV2(null)).toBe(false);
    expect(isCacheV2(undefined)).toBe(false);
    expect(isCacheV2('string')).toBe(false);
    expect(isCacheV2(42)).toBe(false);
  });

  it('retorna false para objeto sem version', () => {
    expect(isCacheV2({ data: [] })).toBe(false);
  });
});

// ── buildCacheV2 ──────────────────────────────────────────────────────────

describe('buildCacheV2', () => {
  const fetchedAt = '2024-01-01T00:00:00.000Z';

  it('cria cache v2 com version: 2', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });
    expect(cache.version).toBe(2);
    expect(isCacheV2(cache)).toBe(true);
  });

  it('persiste myAccountStatus e fetchedAt', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });
    expect(cache.myAccountStatus).toEqual(fakeStatus);
    expect(cache.fetchedAt).toBe(fetchedAt);
  });

  it('mapeia grupos com hasOnboardingUrl em vez de onboardingUrl', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });

    const grp1 = cache.groups.find((g) => g.id === 'grp_1')!;
    expect(grp1.hasOnboardingUrl).toBe(true);
    expect((grp1 as Record<string, unknown>).onboardingUrl).toBeUndefined();

    const grp2 = cache.groups.find((g) => g.id === 'grp_2')!;
    expect(grp2.hasOnboardingUrl).toBe(false);
  });

  it('preserva metadados de grupo (status, type, title, description)', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });
    const grp1 = cache.groups[0];
    expect(grp1.status).toBe('NOT_SENT');
    expect(grp1.type).toBe('IDENTIFICATION');
    expect(grp1.title).toBe('RG ou CNH');
    expect(grp1.description).toBe('Envie frente e verso');
  });

  it('preserva documentos internos do grupo', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });
    expect(cache.groups[0].documents).toEqual([
      { id: 'doc_1', status: 'NOT_SENT', type: 'IDENTIFICATION' },
    ]);
  });

  it('preserva rejectReasons', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });
    expect(cache.rejectReasons).toEqual(['Documento ilegível']);
  });

  it('trata rejectReasons undefined', () => {
    const docs: AsaasMyAccountDocumentsResponse = { data: [] };
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: docs, fetchedAt });
    expect(cache.rejectReasons).toEqual([]);
  });

  it('aceita myAccountStatus null', () => {
    const cache = buildCacheV2({ myAccountStatus: null, documents: fakeDocuments, fetchedAt });
    expect(cache.myAccountStatus).toBeNull();
  });

  it('reconstroi documentos a partir do cache v2 sem expor onboardingUrl em cache', () => {
    const cache = buildCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments, fetchedAt });
    const documents = expandCacheV2Documents(cache);

    expect(documents.data).toEqual([
      {
        id: 'grp_1',
        status: 'NOT_SENT',
        type: 'IDENTIFICATION',
        title: 'RG ou CNH',
        description: 'Envie frente e verso',
        documents: [{ id: 'doc_1', status: 'NOT_SENT', type: 'IDENTIFICATION' }],
        responsible: undefined,
      },
      {
        id: 'grp_2',
        status: 'APPROVED',
        type: 'SOCIAL_CONTRACT',
        title: 'Contrato social',
        description: undefined,
        documents: [],
        responsible: undefined,
      },
    ]);
  });
});

// ── buildWebhookCacheV2 ──────────────────────────────────────────────────

describe('buildWebhookCacheV2', () => {
  it('gera fetchedAt automaticamente', () => {
    const before = new Date().toISOString();
    const cache = buildWebhookCacheV2({ myAccountStatus: fakeStatus, documents: fakeDocuments });
    const after = new Date().toISOString();

    expect(cache.fetchedAt >= before).toBe(true);
    expect(cache.fetchedAt <= after).toBe(true);
    expect(cache.version).toBe(2);
  });
});
