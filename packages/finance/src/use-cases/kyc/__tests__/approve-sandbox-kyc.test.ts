import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  loadCredentials: vi.fn(),
  findProfile: vi.fn(),
  findAccount: vi.fn(),
  claim: vi.fn(),
  updateAccount: vi.fn(),
  syncRegulatory: vi.fn(),
  updateKyc: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  approveSandboxAccount: mocks.approve,
  parseAsaasEnvironmentFromEnv: vi.fn(() => 'sandbox'),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mocks.loadCredentials,
  prisma: {
    financeProfile: { findUnique: mocks.findProfile },
    asaasAccount: {
      findUnique: mocks.findAccount,
      updateMany: mocks.claim,
      update: mocks.updateAccount,
    },
  },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: { syncRegulatoryState: mocks.syncRegulatory },
}));

vi.mock('../kyc-persistence.service', () => ({
  updateKycProcessStatus: mocks.updateKyc,
}));

import { approveSandboxKyc } from '../approve-sandbox-kyc';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadCredentials.mockResolvedValue({ apiKey: 'sandbox_key' });
  mocks.findProfile.mockResolvedValue({ id: 'profile-1' });
  mocks.findAccount.mockResolvedValue({
    id: 'account-1', asaasAccountId: 'asaas-1', kycProcess: { status: 'UNDER_REVIEW' },
  });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.updateAccount.mockResolvedValue({ id: 'account-1' });
  mocks.approve.mockResolvedValue({
    general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED', commercialInfo: 'APPROVED',
  });
});

describe('approveSandboxKyc', () => {
  it('usa a resposta do POST como confirmação sem executar GET posterior', async () => {
    const result = await approveSandboxKyc('conta-1');

    expect(result).toEqual({ success: true, generalStatus: 'APPROVED' });
    expect(mocks.approve).toHaveBeenCalledOnce();
    expect(mocks.syncRegulatory).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', generalStatus: 'APPROVED', source: 'SANDBOX_COMMAND',
    }));
    expect(mocks.updateKyc).toHaveBeenCalledWith({ asaasAccountId: 'account-1', status: 'APPROVED' });
  });

  it('coalesce solicitações concorrentes dentro da janela de proteção', async () => {
    mocks.claim.mockResolvedValue({ count: 0 });

    const result = await approveSandboxKyc('conta-1');

    expect(result).toEqual({ success: true, generalStatus: 'AWAITING_APPROVAL', alreadyRequested: true });
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it('não chama o provedor quando a conta local já está aprovada', async () => {
    mocks.findAccount.mockResolvedValue({
      id: 'account-1', asaasAccountId: 'asaas-1', kycProcess: { status: 'APPROVED' },
    });

    const result = await approveSandboxKyc('conta-1');

    expect(result).toEqual({ success: true, generalStatus: 'APPROVED', alreadyRequested: true });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it('libera a trava para retry quando o Asaas falha', async () => {
    mocks.approve.mockRejectedValue(new Error('timeout'));

    const result = await approveSandboxKyc('conta-1');

    expect(result).toEqual({ success: false, reason: 'ASAAS_ERROR', message: 'timeout' });
    expect(mocks.updateAccount).toHaveBeenCalledWith(expect.objectContaining({
      data: { sandboxApprovalRequestedAt: null },
    }));
  });
});
