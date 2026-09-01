import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), list: vi.fn(),
  create: vi.fn(), updateRemote: vi.fn(), get: vi.fn(), removeBackoff: vi.fn(),
  deleteRemote: vi.fn(), audit: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: { asaasAccount: {
  findFirst: mocks.findFirst, updateMany: mocks.updateMany, update: mocks.update,
} } }));
vi.mock('@alusa/asaas', () => ({
  listWebhooks: mocks.list, createWebhook: mocks.create, updateWebhook: mocks.updateRemote,
  getWebhook: mocks.get, removeWebhookBackoff: mocks.removeBackoff, deleteWebhook: mocks.deleteRemote,
}));
vi.mock('../../foundation/audit-log.service', () => ({ auditLogService: { record: mocks.audit } }));
vi.mock('../../use-cases/asaas-account/expected-webhook-config.server', () => ({
  RECOMMENDED_WEBHOOK_NAME: 'Alusa - Webhook financeiro',
  buildRecommendedWebhookName: (id: string) => `Alusa - Webhook financeiro - ${id}`,
  normalizeWebhookUrlBase: (url: string) => url.replace(/\/+$/, ''),
  hasRequiredWebhookEvents: (current: string[] = [], expected: string[]) =>
    expected.every((event) => current.includes(event)),
  buildExpectedWebhookConfig: (id: string) => ({
    name: `Alusa - Webhook financeiro - ${id}`,
    url: 'https://app.alusa.test/api/webhooks/asaas',
    normalizedUrl: 'https://app.alusa.test/api/webhooks/asaas',
    apiVersion: 3, sendType: 'SEQUENTIALLY',
    events: ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'],
    authToken: '12345678901234567890123456789012', authTokenHash: 'hash-new',
  }),
}));
vi.mock('../../use-cases/asaas-account/webhook-notification-email.server', () => ({
  resolveWebhookNotificationEmail: vi.fn().mockResolvedValue('financeiro@escola.test'),
}));
vi.mock('../asaas-webhook-auth', () => ({
  buildWebhookAuthTokenRotationData: ({ nextHash }: { nextHash: string }) => ({ webhookAuthTokenHash: nextHash }),
}));

import { ensureAsaasWebhookConfiguration } from '../ensure-asaas-webhook-configuration';

const remote = (overrides: Record<string, unknown> = {}) => ({
  id: 'wh_1', name: 'Alusa - Webhook financeiro - fp_1',
  url: 'https://app.alusa.test/api/webhooks/asaas', enabled: true, interrupted: false,
  apiVersion: 3, hasAuthToken: true, sendType: 'SEQUENTIALLY',
  events: ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'], penalizedRequestsCount: 0, ...overrides,
});

describe('ensureAsaasWebhookConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: 'acc_1', webhookId: null, webhookAuthTokenHash: null });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ id: 'acc_1' });
    mocks.audit.mockResolvedValue(undefined);
    mocks.deleteRemote.mockResolvedValue(undefined);
  });

  it('cria com o POST completo, verifica por id e persiste a identidade remota', async () => {
    mocks.list.mockResolvedValue({ data: [] });
    mocks.create.mockResolvedValue({ id: 'wh_1' });
    mocks.get.mockResolvedValue(remote());

    const result = await ensureAsaasWebhookConfiguration({ contaId: 'conta_1', financeProfileId: 'fp_1', apiKey: 'api_key' });

    expect(mocks.create).toHaveBeenCalledWith({ apiKey: 'api_key', data: {
      name: 'Alusa - Webhook financeiro - fp_1', url: 'https://app.alusa.test/api/webhooks/asaas',
      email: 'financeiro@escola.test', enabled: true, interrupted: false, apiVersion: 3,
      authToken: '12345678901234567890123456789012', sendType: 'SEQUENTIALLY',
      events: ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'],
    } });
    expect(mocks.get).toHaveBeenCalledWith({ apiKey: 'api_key', webhookId: 'wh_1' });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { financeProfileId: 'fp_1' },
      data: expect.objectContaining({ webhookId: 'wh_1', webhookStatus: 'ACTIVE' }),
    }));
    expect(result).toMatchObject({ webhookId: 'wh_1', action: 'created', eventsCount: 2 });
  });

  it('atualiza sem campos imutáveis do PUT e remove backoff penalizado', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'acc_1', webhookId: 'wh_1', webhookAuthTokenHash: 'hash-old' });
    mocks.list.mockResolvedValue({ data: [remote({ interrupted: true, penalizedRequestsCount: 2 })] });
    mocks.get.mockResolvedValue(remote());

    await ensureAsaasWebhookConfiguration({ contaId: 'conta_1', financeProfileId: 'fp_1', apiKey: 'api_key' });

    expect(mocks.removeBackoff).toHaveBeenCalledWith({ apiKey: 'api_key', webhookId: 'wh_1' });
    const payload = mocks.updateRemote.mock.calls[0]![0].data;
    expect(payload).toMatchObject({ interrupted: false, authToken: expect.any(String) });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('apiVersion');
  });

  it('preserva eventos opcionais já habilitados no webhook remoto', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'acc_1', webhookId: 'wh_1', webhookAuthTokenHash: 'hash-new' });
    mocks.list.mockResolvedValue({ data: [remote({ events: [
      'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    ] })] });
    mocks.get.mockResolvedValue(remote({ events: [
      'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    ] }));

    const result = await ensureAsaasWebhookConfiguration({ contaId: 'conta_1', financeProfileId: 'fp_1', apiKey: 'api_key' });

    expect(result.action).toBe('unchanged');
    expect(mocks.updateRemote).not.toHaveBeenCalled();
  });

  it('serializa concorrência com lease antes de chamar o Asaas', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(ensureAsaasWebhookConfiguration({ contaId: 'conta_1', financeProfileId: 'fp_1', apiKey: 'api_key' }))
      .rejects.toMatchObject({ code: 'PROVISIONING_IN_PROGRESS', stage: 'ACQUIRE_LEASE' });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('respeita o limite e não apaga webhooks de terceiros', async () => {
    mocks.list.mockResolvedValue({ data: Array.from({ length: 10 }, (_, index) => remote({
      id: `third_party_${index}`, name: `Integração ${index}`,
    })) });
    await expect(ensureAsaasWebhookConfiguration({ contaId: 'conta_1', financeProfileId: 'fp_1', apiKey: 'api_key' }))
      .rejects.toMatchObject({ code: 'WEBHOOK_LIMIT_REACHED' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteRemote).not.toHaveBeenCalled();
  });

  it('bloqueia conta fora do tenant antes da integração externa', async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(ensureAsaasWebhookConfiguration({ contaId: 'conta_incorreta', financeProfileId: 'fp_1', apiKey: 'api_key' }))
      .rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
