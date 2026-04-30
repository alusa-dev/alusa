import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      conta: {
        update: vi.fn(),
        findUnique: vi.fn(),
      },
      usuario: {
        update: vi.fn(),
      },
    },
  };
});

vi.mock('../asaas-account/create-asaas-account', () => {
  return {
    createAsaasAccount: vi.fn(async () => ({
      financeProfileId: 'fp_1',
      asaasAccountId: 'acc_existing',
      status: 'UNDER_REVIEW',
      created: false,
      idempotent: true,
    })),
  };
});

vi.mock('../asaas-account/update-asaas-account', () => {
  return {
    updateAsaasAccount: vi.fn(),
  };
});

vi.mock('../get-onboarding-status', () => {
  return {
    getOnboardingStatus: vi.fn(async () => ({
      status: 'UNDER_REVIEW',
      hasSubaccount: true,
      hasAsaasAccountRecord: true,
      financeProfileId: 'fp_1',
      financeStatus: 'FINANCE_PROFILE_COMPLETED',
      financeProfile: {
        status: 'PENDING',
        isOnboardingCompleted: false,
        onboardingCompletedAt: null,
        lastAsaasSyncAt: null,
      },
    })),
  };
});

vi.mock('../../foundation/finance-profile.service', () => {
  return {
    financeProfileService: {
      setOnboardingData: vi.fn(),
    },
  };
});

import { submitKycData } from '../submit-kyc-data';

describe('submitKycData - idempotência', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar snapshot quando subconta já existe (idempotente)', async () => {
    const { prisma } = await import('@alusa/database');
    const { updateAsaasAccount } = await import('../asaas-account/update-asaas-account');
    const { getOnboardingStatus } = await import('../get-onboarding-status');

    vi.mocked(prisma.conta.findUnique).mockResolvedValue({ ownerUserId: 'u1' } as never);

    const result = await submitKycData({
      contaId: 'c1',
      payload: {
        personType: 'PF',
        ownerName: 'Conta Teste',
        cpfCnpj: '11144477735',
        birthDate: '1990-01-01',
        mobilePhone: '11999999999',
        incomeValue: 1000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01001-000',
        complement: 'Apto 1',
      },
      actor: { type: 'SYSTEM' },
    });

    expect(getOnboardingStatus).toHaveBeenCalledWith('c1');
    expect(updateAsaasAccount).not.toHaveBeenCalled();
    expect(result.status).toBe('UNDER_REVIEW');
  });
});