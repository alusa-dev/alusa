import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSessionMock = vi.fn();
const getExternalAsaasOnboardingStateMock = vi.fn();
const connectExternalAsaasAccountMock = vi.fn();

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@alusa/finance', () => ({
  getExternalAsaasOnboardingState: getExternalAsaasOnboardingStateMock,
  connectExternalAsaasAccount: connectExternalAsaasAccountMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

describe('API /finance/external-onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: {
        id: 'user_admin',
        contaId: 'conta_ext',
        role: 'ADMIN',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
      },
    });
  });

  it('retorna o snapshot do onboarding externo para contas do modo externo', async () => {
    getExternalAsaasOnboardingStateMock.mockResolvedValueOnce({
      mode: 'EXTERNAL_ASAAS_ACCOUNT',
      financeStatus: 'FINANCE_ONBOARDING_STARTED',
      status: 'PENDING_CONFIGURATION',
      schoolName: 'Escola Piloto',
      cpfCnpj: '12345678000199',
      phone: '11999999999',
      asaasAccountId: null,
      asaasEmail: null,
      hasApiKey: false,
    });

    const { GET } = await import('@/app/api/finance/external-onboarding/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getExternalAsaasOnboardingStateMock).toHaveBeenCalledWith('conta_ext');
    expect(body.data.schoolName).toBe('Escola Piloto');
  });

  it('retorna 202 quando a conta conecta mas ainda depende de webhook', async () => {
    connectExternalAsaasAccountMock.mockResolvedValueOnce({
      success: true,
      summary: 'Conta conectada, mas o webhook ainda precisa ser concluído.',
      status: 'WEBHOOK_PENDING',
      webhookAction: 'pending',
      account: {
        asaasAccountId: 'acc_123',
        asaasEmail: 'financeiro@escola.com',
      },
    });

    const { POST } = await import('@/app/api/finance/external-onboarding/route');
    const response = await POST(
      new Request('http://localhost/api/finance/external-onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schoolName: 'Escola Piloto',
          cpfCnpj: '12.345.678/0001-99',
          phone: '(11) 99999-9999',
          apiKey: '$aact_hmlg_test_key',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(connectExternalAsaasAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta_ext',
        schoolName: 'Escola Piloto',
        apiKey: '$aact_hmlg_test_key',
      }),
    );
    expect(body.status).toBe('WEBHOOK_PENDING');
  });
});