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

  it('retorna erro operacional quando o webhook obrigatório não foi concluído', async () => {
    connectExternalAsaasAccountMock.mockResolvedValueOnce({
      success: false,
      summary: 'O Asaas está temporariamente indisponível. Tente novamente em alguns instantes.',
      status: 'FAILED',
      errorCode: 'TEMPORARY_ASAAS_ERROR',
      retryable: true,
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

    expect(response.status).toBe(503);
    expect(connectExternalAsaasAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta_ext',
        schoolName: 'Escola Piloto',
        apiKey: '$aact_hmlg_test_key',
      }),
    );
    expect(body.status).toBe('FAILED');
  });

  it('retorna 409 quando a conta Asaas já está vinculada a outro tenant', async () => {
    connectExternalAsaasAccountMock.mockResolvedValueOnce({
      success: false,
      summary: 'Esta conta Asaas já está vinculada a outra conta da Alusa.',
      status: 'FAILED',
      errorCode: 'ACCOUNT_ALREADY_LINKED',
    });

    const { POST } = await import('@/app/api/finance/external-onboarding/route');
    const response = await POST(
      new Request('http://localhost/api/finance/external-onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schoolName: 'Escola Piloto',
          apiKey: '$aact_hmlg_test_key',
        }),
      }),
    );

    expect(response.status).toBe(409);
  });
});
