import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionUser } from '@/lib/auth/session';
import {
  commitBillingAgreementWeb,
  getBillingAgreementWeb,
  previewBillingAgreementWeb,
} from '@/src/server/billing-agreements/service';

import { GET as getAgreement } from '../[id]/route';
import { POST as commitChange } from '../changes/route';
import { POST as previewChange } from '../changes/preview/route';

vi.mock('@/lib/auth/session', () => ({ getSessionUser: vi.fn() }));
vi.mock('@/src/server/billing-agreements/service', () => ({
  previewBillingAgreementWeb: vi.fn(),
  commitBillingAgreementWeb: vi.fn(),
  getBillingAgreementWeb: vi.fn(),
}));
vi.mock('@/lib/cache/invalidation', () => ({ invalidateChargesCache: vi.fn() }));

const mockedSession = vi.mocked(getSessionUser);
const mockedPreview = vi.mocked(previewBillingAgreementWeb);
const mockedCommit = vi.mocked(commitBillingAgreementWeb);
const mockedGet = vi.mocked(getBillingAgreementWeb);

const baseChange = {
  agreementId: 'agreement-1',
  operation: 'REMOVE_ALLOCATION' as const,
  allocationIds: ['allocation-1'],
  effectivePolicy: 'NEXT_CYCLE' as const,
  effectiveDate: '2026-08-01',
  reason: 'Cancelamento solicitado pelo responsável',
  paidDecreaseHandling: 'CREDIT' as const,
};

describe('billing agreement routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ id: 'user-1', contaId: 'conta-a', role: 'FINANCEIRO' });
  });

  it('não executa preview sem sessão', async () => {
    mockedSession.mockResolvedValue(null);
    const response = await previewChange(new Request('http://localhost/api/billing-agreements/changes/preview', {
      method: 'POST',
      body: JSON.stringify(baseChange),
    }));

    expect(response.status).toBe(401);
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it('rejeita contaId enviado pelo client', async () => {
    const response = await previewChange(new Request('http://localhost/api/billing-agreements/changes/preview', {
      method: 'POST',
      body: JSON.stringify({ ...baseChange, contaId: 'conta-b' }),
    }));

    expect(response.status).toBe(400);
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it('propaga tenant e ator da sessão no preview', async () => {
    mockedPreview.mockResolvedValue({
      agreementId: 'agreement-1',
      operation: 'REMOVE_ALLOCATION',
      effectivePolicy: 'NEXT_CYCLE',
      sourceVersion: 2,
      previewHash: 'preview-hash-123456789',
      expiresAt: '2026-07-21T13:00:00.000Z',
      totals: { currentCents: 30_000, addedCents: 0, removedCents: 10_000, resultingCents: 20_000 },
      affectedPendingPayments: [],
      paidPaymentAdjustments: [],
      warnings: [],
      blockers: [],
      canCommit: true,
    });
    const response = await previewChange(new Request('http://localhost/api/billing-agreements/changes/preview', {
      method: 'POST',
      body: JSON.stringify(baseChange),
    }));

    expect(response.status).toBe(200);
    expect(mockedPreview).toHaveBeenCalledWith({
      contaId: 'conta-a',
      actorId: 'user-1',
      request: baseChange,
    });
  });

  it('bloqueia chaves de idempotência divergentes', async () => {
    const response = await commitChange(new Request('http://localhost/api/billing-agreements/changes', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'header-key-123' },
      body: JSON.stringify({
        ...baseChange,
        idempotencyKey: 'body-key-12345',
        previewHash: 'preview-hash-123456789',
        previewExpiresAt: '2026-07-21T13:00:00.000Z',
        expectedVersion: 2,
      }),
    }));

    expect(response.status).toBe(409);
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it('consulta acordo somente no tenant da sessão', async () => {
    mockedGet.mockResolvedValue({
      id: 'agreement-1',
      status: 'ACTIVE',
      version: 2,
      payer: { type: 'RESPONSAVEL', id: 'payer-1', name: 'Maria' },
      billingType: 'PIX',
      cycle: 'MONTHLY',
      dueDay: 10,
      desiredValueCents: 20_000,
      confirmedValueCents: 20_000,
      reconciliationStatus: 'CONSISTENT',
      allocations: [],
      affectedPayments: [],
      recentOperations: [],
      updatedAt: '2026-07-21T12:00:00.000Z',
    });
    const response = await getAgreement(
      new Request('http://localhost/api/billing-agreements/agreement-1'),
      { params: Promise.resolve({ id: 'agreement-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mockedGet).toHaveBeenCalledWith({ contaId: 'conta-a', agreementId: 'agreement-1' });
  });
});
