import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), list: vi.fn(), update: vi.fn(), create: vi.fn(), restore: vi.fn(), link: vi.fn(),
}));
vi.mock('@alusa/database', () => ({
  prisma: { financeProfile: { findUnique: vi.fn(async () => ({
    asaasAccount: { id: 'account', apiKeyStatus: 'CONNECTED', apiKeyEncrypted: 'encrypted' },
  })) } },
  decryptSecret: () => 'subaccount-key',
}));
vi.mock('@alusa/asaas', async (original) => ({
  ...await original<typeof import('@alusa/asaas')>(),
  getCustomer: mocks.get, listCustomers: mocks.list, updateCustomer: mocks.update,
  createCustomer: mocks.create, restoreCustomer: mocks.restore,
}));
vi.mock('../../customer/customer-identity', () => ({
  linkCustomerIdentity: mocks.link,
  CustomerIdentityConflictError: class extends Error {},
}));
vi.mock('../../services/customer-notification-bridge', () => ({
  syncCustomerNotificationChannelsFromTenantPreferences: vi.fn(),
}));
import { ensureAsaasCustomerForPayer } from '../ensure-asaas-customer-for-payer';

const payer = { type: 'ALUNO' as const, id: 'adult', name: 'Adult', cpfCnpj: '11144477735' };
const input = { contaId: 'tenant', payer, notificationSyncMode: 'skip' as const };

describe('cadastro shared financial identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
    vi.stubEnv('PLAYWRIGHT_TEST', 'false');
    mocks.list.mockResolvedValue({ data: [] });
    mocks.link.mockResolvedValue({ id: 'canonical', asaasCustomerId: 'remote', externalReference: 'original-responsavel-reference' });
    mocks.get.mockResolvedValue({ id: 'remote', cpfCnpj: payer.cpfCnpj });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('links adult role to canonical customer before update and preserves its reference', async () => {
    const result = await ensureAsaasCustomerForPayer({ ...input, payer: { ...payer, asaasCustomerId: 'remote' } });
    expect(result).toMatchObject({ ok: true, customerId: 'remote', externalReference: 'original-responsavel-reference' });
    expect(mocks.link).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'tenant', payerType: 'ALUNO', payerId: 'adult', cpfCnpj: payer.cpfCnpj }));
    expect(mocks.link.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalReference: 'original-responsavel-reference' }) }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects supplied remote id with different CPF before writes', async () => {
    mocks.get.mockResolvedValue({ id: 'remote', cpfCnpj: '52998224725' });
    const result = await ensureAsaasCustomerForPayer({ ...input, payer: { ...payer, asaasCustomerId: 'remote' } });
    expect(result).toMatchObject({ ok: false, error: 'PAYER_INVALID' });
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects external reference collision rather than overwriting CPF', async () => {
    mocks.list.mockResolvedValueOnce({ data: [{ id: 'wrong', cpfCnpj: '52998224725' }] });
    expect(await ensureAsaasCustomerForPayer(input)).toMatchObject({ ok: false, error: 'PAYER_INVALID' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it('uses only exact normalized CPF matches from list search', async () => {
    mocks.list.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [
      { id: 'wrong', cpfCnpj: '52998224725' },
      { id: 'remote', cpfCnpj: '111.444.777-35' },
    ] });
    expect(await ensureAsaasCustomerForPayer(input)).toMatchObject({ ok: true, customerId: 'remote' });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'remote' }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
