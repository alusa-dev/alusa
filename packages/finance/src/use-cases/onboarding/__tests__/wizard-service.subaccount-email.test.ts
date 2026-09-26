import { beforeEach, describe, expect, it, vi } from 'vitest';

const financeProfileFindUniqueMock = vi.hoisted(() => vi.fn());
const financeProfileUpdateMock = vi.hoisted(() => vi.fn());
const contaFindUniqueMock = vi.hoisted(() => vi.fn());
const getOrCreateByTenantMock = vi.hoisted(() => vi.fn());
const auditRecordMock = vi.hoisted(() => vi.fn());

vi.mock('@alusa/database', () => ({
  prisma: {
    financeProfile: {
      findUnique: financeProfileFindUniqueMock,
      update: financeProfileUpdateMock,
    },
    conta: { findUnique: contaFindUniqueMock },
  },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: { getOrCreateByTenant: getOrCreateByTenantMock },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: auditRecordMock },
}));

vi.mock('../../../jobs/provision-asaas-subaccounts', () => ({
  enqueueAsaasSubaccountProvisioning: vi.fn(),
  processAsaasProvisioningJobs: vi.fn(),
}));

describe('saveWizardStep3: e-mail da subconta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrCreateByTenantMock.mockResolvedValue({ id: 'profile-1' });
    financeProfileUpdateMock.mockResolvedValue({ id: 'profile-1' });
    financeProfileFindUniqueMock.mockResolvedValue({
      wizardStep: 3,
      wizardCompletedAt: null,
      draftPersonType: 'PJ',
      draftCpfCnpj: '11367839000189',
      draftBirthDate: null,
      asaasOwnerName: 'Escola Horizonte',
      asaasCompanyName: 'Escola Horizonte Ltda',
      companyType: 'MEI',
      mobilePhone: '97981283106',
      landlinePhone: null,
      incomeValue: 5000,
      address: null,
      addressNumber: null,
      province: null,
      addressCity: null,
      addressState: null,
      postalCode: null,
      complement: null,
      asaasLoginEmail: null,
      asaasSubaccountEmail: 'financeiro@escola.example',
    });
    contaFindUniqueMock.mockResolvedValue({
      nome: 'Escola Horizonte',
      cpfCnpj: '11367839000189',
      ownerUser: { email: 'owner@alusa.example' },
    });
  });

  it('salva e devolve o e-mail financeiro escolhido sem alterar o login da Alusa', async () => {
    const { saveWizardStep3 } = await import('../wizard-service');

    const result = await saveWizardStep3({
      contaId: 'conta-1',
      data: {
        mobilePhone: '(97) 98128-3106',
        subaccountEmail: ' financeiro@escola.example ',
      },
    });

    expect(financeProfileUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'profile-1' },
      data: expect.objectContaining({
        mobilePhone: '97981283106',
        asaasSubaccountEmail: 'financeiro@escola.example',
      }),
    }));
    expect(result.wizard).toMatchObject({
      loginEmail: null,
      subaccountEmail: 'financeiro@escola.example',
    });
  });
});
