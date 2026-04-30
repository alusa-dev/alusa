import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMyAccountCommercialInfo = vi.fn();
const mockUpdateMyAccountCommercialInfo = vi.fn();

vi.mock('@alusa/asaas', async () => ({
  getMyAccountCommercialInfo: (...args: unknown[]) => mockGetMyAccountCommercialInfo(...args),
  updateMyAccountCommercialInfo: (...args: unknown[]) => mockUpdateMyAccountCommercialInfo(...args),
}));

vi.mock('@alusa/database', async () => ({
  prisma: {
    asaasAccount: {
      findUnique: vi.fn(async () => ({
        id: 'aa1',
        asaasAccountId: 'acc_1',
        status: 'CREATED',
        commercialInfoScheduledDate: null,
        asaasAccountEmail: 'owner@test.com',
      })),
      update: vi.fn(async () => ({ id: 'aa1' })),
    },
    conta: {
      findUnique: vi.fn(async () => ({
        cpfCnpj: '12345678909',
        ownerUserId: 'user_1',
      })),
    },
    usuario: {
      findUnique: vi.fn(async () => ({
        email: 'owner@test.com',
        birthDate: new Date('1990-01-15T00:00:00.000Z'),
      })),
      findFirst: vi.fn(),
    },
    financeProfile: {
      findUnique: vi.fn(async () => ({
        asaasOwnerName: 'Owner Test',
        asaasCompanyName: null,
        asaasName: 'Owner Test',
        asaasPhone: null,
        asaasSite: null,
        mobilePhone: '11999998888',
        incomeValue: 5000,
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        postalCode: '01234567',
        complement: null,
        companyType: null,
      })),
    },
  },
  loadAsaasCredentials: vi.fn(async () => ({ apiKey: '$aact_sub_123' })),
}));

vi.mock('../../foundation/finance-profile.service', async () => ({
  financeProfileService: {
    getOrCreateByTenant: vi.fn(async () => ({ id: 'fp1' })),
  },
}));

vi.mock('../../foundation/audit-log.service', async () => ({
  auditLogService: {
    record: vi.fn(async () => ({ id: 'audit_1' })),
  },
}));

import { updateAsaasAccount } from '../asaas-account/update-asaas-account';

describe('updateAsaasAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetMyAccountCommercialInfo.mockResolvedValue({
      personType: 'FISICA',
      cpfCnpj: '12345678909',
      name: 'Owner Test',
      birthDate: '1990-01-15',
      incomeValue: 5000,
      email: 'owner@test.com',
      mobilePhone: '11999998888',
      postalCode: '01234567',
      address: 'Rua Teste',
      addressNumber: '123',
      province: 'Centro',
      commercialInfoExpiration: null,
    });

    mockUpdateMyAccountCommercialInfo.mockResolvedValue({
      email: 'owner@test.com',
      commercialInfoExpiration: null,
    });
  });

  it('usa o email original do usuário como email canônico da subconta', async () => {
    await updateAsaasAccount({
      contaId: 'conta_1',
      data: {},
      actor: { type: 'SYSTEM' },
    });

    expect(mockUpdateMyAccountCommercialInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: '$aact_sub_123',
        data: expect.objectContaining({
          email: 'owner@test.com',
        }),
      }),
    );
  });
});
