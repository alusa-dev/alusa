import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOrCreateByTenantMock = vi.fn();
const enqueueAsaasSubaccountProvisioningMock = vi.fn();
const auditLogRecordMock = vi.fn();

const contaFindUniqueMock = vi.fn();
const financeProfileFindUniqueMock = vi.fn();
const financeProfileUpdateMock = vi.fn();
const contaUpdateMock = vi.fn();
const transactionMock = vi.fn();

vi.mock('@alusa/database', () => ({
  prisma: {
    conta: {
      findUnique: contaFindUniqueMock,
      update: contaUpdateMock,
    },
    financeProfile: {
      findUnique: financeProfileFindUniqueMock,
      update: financeProfileUpdateMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: getOrCreateByTenantMock,
  },
}));

vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: auditLogRecordMock,
  },
}));

vi.mock('../../../jobs/provision-asaas-subaccounts', () => ({
  enqueueAsaasSubaccountProvisioning: enqueueAsaasSubaccountProvisioningMock,
}));

describe('completeWizard em modo externo', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getOrCreateByTenantMock.mockResolvedValue({ id: 'profile_1' });
    contaFindUniqueMock
      .mockResolvedValueOnce({ financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT' })
      .mockResolvedValue({
        nome: 'Elaine Costa',
        cpfCnpj: '0279786276',
        enderecoLogradouro: 'Rua Nova II',
        enderecoNumero: '196',
        enderecoBairro: 'São João',
        enderecoCep: '69553315',
        enderecoCidade: 'Tefé',
        enderecoUf: 'AM',
      });
    financeProfileFindUniqueMock
      .mockResolvedValueOnce({
        wizardStep: 5,
        wizardCompletedAt: null,
        draftPersonType: 'PF',
        draftCpfCnpj: '0279786276',
        draftBirthDate: new Date('1995-12-30T00:00:00.000Z'),
        asaasOwnerName: 'Elaine Costa',
        asaasCompanyName: 'Elaine Costa',
        companyType: null,
        mobilePhone: '11999999999',
        landlinePhone: null,
        incomeValue: { toNumber: () => 5000 },
        address: 'Rua Nova II',
        addressNumber: '196',
        province: 'São João',
        postalCode: '69553315',
        ownerEmail: 'balletelainecosta@gmail.com',
      })
      .mockResolvedValueOnce({
        wizardStep: 6,
        wizardCompletedAt: new Date('2026-05-11T00:00:00.000Z'),
        draftPersonType: 'PF',
        draftCpfCnpj: '0279786276',
        draftBirthDate: new Date('1995-12-30T00:00:00.000Z'),
        asaasOwnerName: 'Elaine Costa',
        asaasCompanyName: 'Elaine Costa',
        companyType: null,
        mobilePhone: '11999999999',
        landlinePhone: null,
        incomeValue: { toNumber: () => 5000 },
        address: 'Rua Nova II',
        addressNumber: '196',
        province: 'São João',
        postalCode: '69553315',
        ownerEmail: 'balletelainecosta@gmail.com',
      });

    financeProfileUpdateMock.mockReturnValue({ kind: 'financeProfile.update' });
    contaUpdateMock.mockReturnValue({ kind: 'conta.update' });
    transactionMock.mockResolvedValue(undefined);
  });

  it('conclui o wizard localmente sem provisionar subconta', async () => {
    const { completeWizard } = await import('../wizard-service');

    const result = await completeWizard({
      contaId: 'conta_ext_1',
      actor: { type: 'USER', id: 'user_1' },
    });

    expect(enqueueAsaasSubaccountProvisioningMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(contaUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conta_ext_1' },
        data: { financeStatus: 'FINANCE_PROFILE_COMPLETED' },
      }),
    );
    expect(result.success).toBe(true);
    expect(result.canCreateSubaccount).toBe(false);
    expect(result.wizard.step).toBe(6);
    expect(auditLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.wizard.complete_external_mode',
      }),
    );
  });

  it('conclui wizard whitelabel enfileirando provisionamento assíncrono', async () => {
    const { completeWizard } = await import('../wizard-service');

    getOrCreateByTenantMock.mockReset();
    contaFindUniqueMock.mockReset();
    financeProfileFindUniqueMock.mockReset();
    financeProfileUpdateMock.mockReset();
    contaUpdateMock.mockReset();
    transactionMock.mockReset();
    auditLogRecordMock.mockReset();
    enqueueAsaasSubaccountProvisioningMock.mockReset();
    getOrCreateByTenantMock.mockResolvedValue({ id: 'profile_2' });
    contaFindUniqueMock
      .mockResolvedValueOnce({ financeIntegrationMode: 'WHITELABEL_BAAS' })
      .mockResolvedValue({
        nome: 'Escola Alusa',
        cpfCnpj: '11144477735',
      });
    financeProfileFindUniqueMock
      .mockResolvedValueOnce({
        wizardStep: 5,
        wizardCompletedAt: null,
        draftPersonType: 'PF',
        draftCpfCnpj: '11144477735',
        draftBirthDate: '1990-01-01',
        asaasOwnerName: 'Maria Silva',
        asaasCompanyName: null,
        companyType: null,
        mobilePhone: '11999999999',
        landlinePhone: null,
        incomeValue: { toNumber: () => 5000 },
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        addressCity: 'Manaus',
        addressState: 'AM',
        postalCode: '69000000',
        complement: null,
        asaasLoginEmail: null,
      })
      .mockResolvedValueOnce({
        wizardStep: 6,
        wizardCompletedAt: new Date('2026-05-11T00:00:00.000Z'),
        draftPersonType: 'PF',
        draftCpfCnpj: '11144477735',
        draftBirthDate: '1990-01-01',
        asaasOwnerName: 'Maria Silva',
        asaasCompanyName: null,
        companyType: null,
        mobilePhone: '11999999999',
        landlinePhone: null,
        incomeValue: { toNumber: () => 5000 },
        address: 'Rua Teste',
        addressNumber: '123',
        province: 'Centro',
        addressCity: 'Manaus',
        addressState: 'AM',
        postalCode: '69000000',
        complement: null,
        asaasLoginEmail: null,
      });
    enqueueAsaasSubaccountProvisioningMock.mockResolvedValue({
      financeProfileId: 'profile_2',
      queued: true,
      status: 'QUEUED',
      asaasAccountId: null,
    });
    financeProfileUpdateMock.mockReturnValue({ kind: 'financeProfile.update' });
    contaUpdateMock.mockReturnValue({ kind: 'conta.update' });
    transactionMock.mockResolvedValue(undefined);

    const result = await completeWizard({
      contaId: 'conta_whitelabel_1',
      actor: { type: 'USER', id: 'user_1' },
    });

    expect(enqueueAsaasSubaccountProvisioningMock).toHaveBeenCalledWith({
      contaId: 'conta_whitelabel_1',
      actor: { type: 'USER', id: 'user_1' },
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(contaUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conta_whitelabel_1' },
        data: { financeStatus: 'FINANCE_PROFILE_COMPLETED' },
      }),
    );
    expect(result.success).toBe(true);
    expect(result.provisioningStatus).toBe('QUEUED');
    expect(result.wizard.step).toBe(6);
  });
});
