import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findProfile: vi.fn(),
  findAccount: vi.fn(),
  updateAccount: vi.fn().mockResolvedValue({ id: 'acc-1' }),
  claimAccount: vi.fn().mockResolvedValue({ count: 1 }),
  createHistory: vi.fn().mockResolvedValue({ id: 'hist-1' }),
  updateProfile: vi.fn().mockResolvedValue({ id: 'prof-1' }),
  upsertKyc: vi.fn().mockResolvedValue({ id: 'proc-1' }),
  updateConta: vi.fn().mockResolvedValue({ id: 'conta-1' }),
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    financeProfile: { findUnique: mocks.findProfile },
    asaasAccount: { findUnique: mocks.findAccount, update: mocks.updateAccount },
    kycProcess: { upsert: mocks.upsertKyc },
    kycRequirement: { upsert: vi.fn().mockResolvedValue({ id: 'req-1' }) },
    kycSlot: { upsert: vi.fn().mockResolvedValue({ id: 'slot-1' }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      asaasAccount: { updateMany: mocks.claimAccount },
      asaasAccountStatusHistory: { create: mocks.createHistory },
      financeProfile: { update: mocks.updateProfile },
      kycProcess: { upsert: mocks.upsertKyc },
      conta: { update: mocks.updateConta },
    })),
  },
  loadAsaasCredentials: vi.fn().mockResolvedValue({
    apiKey: 'sandbox_key', apiKeyStatus: 'CONNECTED', source: 'asaasCredentialRef',
  }),
}));

vi.mock('@alusa/asaas', () => ({
  getMyAccountStatus: vi.fn().mockResolvedValue({ general: 'PENDING', documentation: 'PENDING', bankAccountInfo: 'PENDING' }),
  getMyAccountDocuments: vi.fn().mockResolvedValue({ data: [], rejectReasons: [] }),
}));

vi.mock('../../foundation/audit-log.service', () => ({ auditLogService: { record: mocks.audit } }));

import { handleAccountWebhook } from '../account-webhook-handler';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimAccount.mockResolvedValue({ count: 1 });
  mocks.findProfile.mockResolvedValue({ id: 'prof-1', onboardingCompletedAt: new Date('2026-08-01T12:00:00Z') });
  mocks.findAccount.mockResolvedValue({
    id: 'acc-1', status: 'APPROVED', asaasAccountId: 'ext-1',
    commercialInfoStatus: null, commercialInfoScheduledDate: null,
    lastAccountStatusEventAt: new Date('2026-08-01T12:00:00Z'),
  });
});

describe('handleAccountWebhook — autoridade e ordenação', () => {
  it('evento de documento não rebaixa a aprovação geral', async () => {
    const result = await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_DOCUMENT_PENDING', payloadId: 'evt-area',
    });
    expect(result.success).toBe(true);
    expect(mocks.claimAccount).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it('evento geral explícito pode rebaixar APPROVED para PENDING', async () => {
    await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING', payloadId: 'evt-general',
      eventCreatedAt: '2026-08-01T12:01:00Z',
    });
    expect(mocks.claimAccount).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'UNDER_REVIEW' }),
    }));
    expect(mocks.upsertKyc).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'PENDING_DOCUMENTS' }),
    }));
  });

  it('ignora evento geral mais antigo que o último aplicado', async () => {
    await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED', payloadId: 'evt-old',
      eventCreatedAt: '2026-08-01T11:59:00Z',
    });
    expect(mocks.claimAccount).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'finance.onboarding.out_of_order_event_ignored',
    }));
  });

  it('não aplica projeções parciais quando outro evento vence a concorrência', async () => {
    mocks.claimAccount.mockResolvedValue({ count: 0 });
    await handleAccountWebhook('conta-1', {
      event: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED', payloadId: 'evt-race',
      eventCreatedAt: '2026-08-01T12:02:00Z',
    });
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(mocks.upsertKyc).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'finance.onboarding.concurrent_event_deferred',
    }));
  });
});
