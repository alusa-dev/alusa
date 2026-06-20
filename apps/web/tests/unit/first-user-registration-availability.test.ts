import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  usuarioFindFirstMock,
  asaasGetMyAccountMock,
  asaasListSubaccountsMock,
} = vi.hoisted(() => ({
  usuarioFindFirstMock: vi.fn(),
  asaasGetMyAccountMock: vi.fn(),
  asaasListSubaccountsMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    usuario: {
      findFirst: usuarioFindFirstMock,
    },
  },
}));

vi.mock('@alusa/finance', () => ({
  asaasGetMyAccount: asaasGetMyAccountMock,
  asaasListSubaccounts: asaasListSubaccountsMock,
}));

describe('checkFirstUserRegistrationAvailability', () => {
  const originalAsaasApiKey = process.env.ASAAS_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ASAAS_API_KEY = '$aact_test_master_key';
    usuarioFindFirstMock.mockResolvedValue(null);
    asaasGetMyAccountMock.mockResolvedValue({ email: 'master@example.com' });
    asaasListSubaccountsMock.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    if (typeof originalAsaasApiKey === 'undefined') {
      delete process.env.ASAAS_API_KEY;
    } else {
      process.env.ASAAS_API_KEY = originalAsaasApiKey;
    }
  });

  it('bloqueia o e-mail da conta mestra antes de consultar subcontas', async () => {
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({
        email: ' MASTER@example.com ',
        financeIntegrationMode: 'WHITELABEL_BAAS',
      }),
    ).resolves.toEqual({ available: false, reason: 'ASAAS_EMAIL_IN_USE' });

    expect(asaasGetMyAccountMock).toHaveBeenCalledWith({ apiKey: '$aact_test_master_key' });
    expect(asaasListSubaccountsMock).not.toHaveBeenCalled();
  });

  it('bloqueia e-mail encontrado no cadastro financeiro mesmo quando não é a conta mestra', async () => {
    asaasListSubaccountsMock.mockResolvedValueOnce({ data: [{ id: 'acc_1', email: 'school@example.com' }] });
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({
        email: 'school@example.com',
        financeIntegrationMode: 'WHITELABEL_BAAS',
      }),
    ).resolves.toEqual({ available: false, reason: 'ASAAS_EMAIL_IN_USE' });

    expect(asaasListSubaccountsMock).toHaveBeenCalledWith({
      apiKey: '$aact_test_master_key',
      email: 'school@example.com',
      limit: 1,
      offset: 0,
    });
  });

  it('libera e-mail inexistente localmente e no cadastro financeiro', async () => {
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({
        email: 'new@example.com',
        financeIntegrationMode: 'WHITELABEL_BAAS',
      }),
    ).resolves.toEqual({ available: true });
  });

  it('não consulta cadastro financeiro no modo de conta existente', async () => {
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({
        email: 'existing@example.com',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
      }),
    ).resolves.toEqual({ available: true });

    expect(asaasGetMyAccountMock).not.toHaveBeenCalled();
    expect(asaasListSubaccountsMock).not.toHaveBeenCalled();
  });
});
