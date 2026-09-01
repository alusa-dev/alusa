import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AsaasHttpError } from '@alusa/asaas';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  loadCredentials: vi.fn(),
  listWebhooks: vi.fn(),
  ensureWebhook: vi.fn(),
  issueUpsert: vi.fn(),
  issueUpdateMany: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: { findFirst: mocks.findFirst },
    financeReconciliationIssue: {
      upsert: mocks.issueUpsert,
      updateMany: mocks.issueUpdateMany,
    },
  },
  loadAsaasCredentials: mocks.loadCredentials,
}));

vi.mock('@alusa/asaas', () => ({
  listWebhooks: mocks.listWebhooks,
  ASAAS_WEBHOOK_EVENTS: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
  AsaasHttpError: class AsaasHttpError extends Error {
    status: number;
    responseBody: unknown;

    constructor(message: string, status: number, responseBody: unknown) {
      super(message);
      this.status = status;
      this.responseBody = responseBody;
    }
  },
}));

vi.mock('../webhook-provisioning-events', () => ({
  DEFAULT_WEBHOOK_PROVISIONING_CAPABILITIES: ['CORE_FINANCE'],
  getWebhookEventsForCapabilities: () => ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
  PROVISIONED_WEBHOOK_EVENTS: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
}));

vi.mock('../ensure-asaas-webhook-configuration', () => ({
  ensureAsaasWebhookConfiguration: mocks.ensureWebhook,
  selectAlusaWebhookCandidate: ({ webhooks, persistedWebhookId, expectedName }: {
    webhooks: Array<{ id: string; name: string }>;
    persistedWebhookId?: string | null;
    expectedName: string;
  }) => webhooks.find((item) => item.id === persistedWebhookId)
    ?? webhooks.find((item) => item.name === expectedName)
    ?? webhooks.find((item) => item.name === 'Alusa - Webhook financeiro')
    ?? null,
}));

vi.mock('../../use-cases/asaas-account/asaas-env', () => ({
  resolveWebhookUrl: vi.fn(() => 'https://app.alusa.test/api/webhooks/asaas'),
  canonicalizePublicHostname: vi.fn((value: string) => value),
}));

vi.mock('../../use-cases/asaas-account/webhook-auth-token', () => ({
  resolveWebhookAuthToken: vi.fn(() => 'token-1'),
  hashWebhookAuthToken: vi.fn(() => 'hash-1'),
}));

import { getWebhookConfigDriftStatus, repairWebhookConfigDrift } from '../webhook-config-drift.service';

const remoteWebhook = (overrides: Record<string, unknown> = {}) => ({
  id: 'wh_1',
  name: 'Alusa - Webhook financeiro - fp1',
  url: 'https://app.alusa.test/api/webhooks/asaas',
  enabled: true,
  interrupted: false,
  apiVersion: 3,
  hasAuthToken: true,
  sendType: 'SEQUENTIALLY',
  penalizedRequestsCount: 0,
  events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
  ...overrides,
});

describe('webhook-config-drift.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: 'acc_1',
      asaasAccountId: 'asaas_acc_1',
      financeProfileId: 'fp_1',
      webhookId: 'wh_1',
      webhookAuthTokenHash: 'hash-1',
      financeProfile: { contaId: 'conta-1' },
    });
    mocks.loadCredentials.mockResolvedValue({ apiKey: 'key_1' });
    mocks.issueUpsert.mockResolvedValue({ id: 'issue_1' });
    mocks.issueUpdateMany.mockResolvedValue({ count: 1 });
    mocks.ensureWebhook.mockResolvedValue({ webhookId: 'wh_1' });
  });

  it('detecta drift remoto de eventos, token e interrupção', async () => {
    mocks.listWebhooks.mockResolvedValue({
      data: [remoteWebhook({
        interrupted: true,
        hasAuthToken: false,
        sendType: 'NON_SEQUENTIAL',
        penalizedRequestsCount: 2,
        events: ['PAYMENT_CONFIRMED'],
      })],
      hasMore: false,
    });

    const result = await getWebhookConfigDriftStatus('conta-1');

    expect(result?.drift).toMatchObject({
      interrupted: true,
      missingAuthToken: true,
      sendTypeMismatch: true,
      penalized: true,
      missingEvents: ['PAYMENT_PARTIALLY_REFUNDED'],
    });
  });

  it('prefere o webhookId persistido e ignora contador histórico sem interrupção', async () => {
    mocks.listWebhooks.mockResolvedValue({
      data: [
        remoteWebhook({ id: 'wh_legacy', name: 'Alusa - Webhook financeiro', interrupted: true }),
        remoteWebhook({ id: 'wh_1', penalizedRequestsCount: 4 }),
      ],
      hasMore: false,
    });

    const result = await getWebhookConfigDriftStatus('conta-1');

    expect(result?.remote.webhookId).toBe('wh_1');
    expect(result?.drift.penalized).toBe(false);
  });

  it('trata evento opcional extra como informação, sem criar drift do núcleo', async () => {
    mocks.listWebhooks.mockResolvedValue({
      data: [remoteWebhook({
        events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED'],
      })],
      hasMore: false,
    });

    const result = await getWebhookConfigDriftStatus('conta-1');

    expect(result?.drift.eventsMismatch).toBe(false);
    expect(result?.drift.missingEvents).toEqual([]);
    expect(result?.drift.extraEvents).toEqual(['PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED']);
  });

  it('delega o reparo ao serviço canônico e verifica novamente', async () => {
    mocks.listWebhooks
      .mockResolvedValueOnce({ data: [remoteWebhook({ enabled: false })], hasMore: false })
      .mockResolvedValueOnce({ data: [remoteWebhook()], hasMore: false });

    const result = await repairWebhookConfigDrift({ contaId: 'conta-1', actor: { type: 'SYSTEM' } });

    expect(result.repaired).toBe(true);
    expect(result.reason).toBe('REPAIRED');
    expect(mocks.ensureWebhook).toHaveBeenCalledWith({
      contaId: 'conta-1',
      financeProfileId: 'fp_1',
      apiKey: 'key_1',
      actor: { type: 'SYSTEM' },
    });
    expect(mocks.listWebhooks).toHaveBeenCalledTimes(2);
  });

  it('classifica 400 do Asaas como erro do provedor e preserva detalhes seguros', async () => {
    mocks.listWebhooks.mockResolvedValue({
      data: [remoteWebhook({ enabled: false })],
      hasMore: false,
    });
    mocks.ensureWebhook.mockRejectedValue(Object.assign(new Error('Webhook inválido'), { status: 400 }));

    const result = await repairWebhookConfigDrift({ contaId: 'conta-1', actor: { type: 'SYSTEM' } });

    expect(result).toMatchObject({
      repaired: false,
      reason: 'PROVIDER_ERROR',
      failureStatus: 400,
      failureCategory: 'unknown_error',
    });
  });

  it('classifica indisponibilidade do Pix Automático sem sugerir retry', async () => {
    mocks.listWebhooks.mockResolvedValue({
      data: [remoteWebhook({ enabled: false })],
      hasMore: false,
    });
    mocks.ensureWebhook.mockRejectedValue(new AsaasHttpError('Bad Request', 400, {
      errors: [{
        code: 'invalid_object',
        description: 'O Pix Automático não está disponível para sua conta no momento.',
      }],
    }));

    const result = await repairWebhookConfigDrift({ contaId: 'conta-1', actor: { type: 'SYSTEM' } });

    expect(result).toMatchObject({
      repaired: false,
      reason: 'UNSUPPORTED_FEATURE',
      failureStatus: 400,
      failureCategory: 'unsupported_feature',
    });
  });
});
