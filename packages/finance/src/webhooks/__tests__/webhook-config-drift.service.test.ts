import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFindFirst,
  mockFindUnique,
  mockUpdateAccount,
  mockLoadCreds,
  mockCreateWebhook,
  mockListWebhooks,
  mockUpdateWebhook,
  mockRemoveWebhookBackoff,
  mockAuditRecord,
  mockIssueUpsert,
  mockIssueUpdateMany,
  mockResolveWebhookNotificationEmail,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdateAccount: vi.fn(),
  mockLoadCreds: vi.fn(),
  mockCreateWebhook: vi.fn(),
  mockListWebhooks: vi.fn(),
  mockUpdateWebhook: vi.fn(),
  mockRemoveWebhookBackoff: vi.fn(),
  mockAuditRecord: vi.fn().mockResolvedValue(undefined),
  mockIssueUpsert: vi.fn().mockResolvedValue({ id: 'issue_1' }),
  mockIssueUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  mockResolveWebhookNotificationEmail: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: {
      findFirst: mockFindFirst,
      findUnique: mockFindUnique,
      update: mockUpdateAccount,
    },
    financeReconciliationIssue: {
      upsert: mockIssueUpsert,
      updateMany: mockIssueUpdateMany,
    },
  },
  loadAsaasCredentials: mockLoadCreds,
}));

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    status: number;
    constructor(message = 'AsaasHttpError', status = 500) {
      super(message);
      this.status = status;
    }
  },
  createWebhook: mockCreateWebhook,
  listWebhooks: mockListWebhooks,
  updateWebhook: mockUpdateWebhook,
  removeWebhookBackoff: mockRemoveWebhookBackoff,
}));

vi.mock('../webhook-provisioning-events', () => ({
  PROVISIONED_WEBHOOK_EVENTS: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

vi.mock('../../use-cases/asaas-account/asaas-env', () => ({
  resolveWebhookUrl: vi.fn(() => 'https://app.alusa.test/api/webhooks/asaas'),
}));

vi.mock('../../use-cases/asaas-account/webhook-auth-token', () => ({
  deriveWebhookAuthToken: vi.fn(() => 'token-1'),
  resolveWebhookAuthToken: vi.fn(() => 'token-1'),
  hashWebhookAuthToken: vi.fn(() => 'hash-1'),
}));

vi.mock('../../use-cases/asaas-account/webhook-notification-email.server', () => ({
  resolveWebhookNotificationEmail: mockResolveWebhookNotificationEmail,
}));

import { getWebhookConfigDriftStatus, repairWebhookConfigDrift } from '../webhook-config-drift.service';

describe('webhook-config-drift.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindFirst.mockResolvedValue({
      id: 'acc_1',
      asaasAccountId: 'asaas_acc_1',
      financeProfileId: 'fp_1',
      webhookAuthTokenHash: 'hash-old',
      financeProfile: { contaId: 'conta-1' },
    });
    mockFindUnique.mockResolvedValue({ webhookAuthTokenHash: 'hash-old' });
    mockLoadCreds.mockResolvedValue({ apiKey: 'key_1' });
    mockResolveWebhookNotificationEmail.mockResolvedValue('billing@alusa.test');
  });

  it('detecta drift remoto de eventos, token e interrupção', async () => {
    mockListWebhooks.mockResolvedValue({
      data: [
        {
          id: 'wh_1',
          name: 'Alusa - Webhook financeiro',
          url: 'https://app.alusa.test/api/webhooks/asaas',
          enabled: true,
          interrupted: true,
          hasAuthToken: false,
          sendType: 'NON_SEQUENTIAL',
          penalizedRequestsCount: 2,
          events: ['PAYMENT_CONFIRMED'],
        },
      ],
    });

    const result = await getWebhookConfigDriftStatus('conta-1');

    expect(result).toMatchObject({
      contaId: 'conta-1',
      canRepair: true,
      drift: {
        interrupted: true,
        missingAuthToken: true,
        sendTypeMismatch: true,
        localHashMismatch: true,
        penalized: true,
        missingEvents: ['PAYMENT_PARTIALLY_REFUNDED'],
      },
    });
  });

  it('ignora contador histórico de penalização quando a fila não está interrompida', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'acc_1',
      asaasAccountId: 'asaas_acc_1',
      financeProfileId: 'fp_1',
      webhookAuthTokenHash: 'hash-1',
      financeProfile: { contaId: 'conta-1' },
    });
    mockListWebhooks.mockResolvedValue({
      data: [
        {
          id: 'wh_1',
          name: 'Alusa - Webhook financeiro',
          url: 'https://app.alusa.test/api/webhooks/asaas',
          enabled: true,
          interrupted: false,
          hasAuthToken: true,
          sendType: 'SEQUENTIALLY',
          penalizedRequestsCount: 1,
          events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
        },
      ],
    });

    const result = await getWebhookConfigDriftStatus('conta-1');

    expect(result?.drift.penalized).toBe(false);
  });

  it('repara webhook remoto existente e persiste hash local', async () => {
    mockListWebhooks
      .mockResolvedValueOnce({
        data: [
          {
            id: 'wh_1',
            name: 'Alusa - Webhook financeiro',
            url: 'https://app.alusa.test/api/webhooks/asaas',
            enabled: false,
            interrupted: true,
            hasAuthToken: false,
            sendType: 'NON_SEQUENTIAL',
            penalizedRequestsCount: 1,
            events: ['PAYMENT_CONFIRMED'],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'wh_1',
            name: 'Alusa - Webhook financeiro',
            url: 'https://app.alusa.test/api/webhooks/asaas',
            enabled: true,
            interrupted: false,
            hasAuthToken: true,
            sendType: 'SEQUENTIALLY',
            penalizedRequestsCount: 0,
            events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
          },
        ],
      });

    const result = await repairWebhookConfigDrift({ contaId: 'conta-1', actor: { type: 'SYSTEM' } });

    expect(result.repaired).toBe(true);
    expect(result.reason).toBe('REPAIRED');
    expect(mockRemoveWebhookBackoff).toHaveBeenCalledWith({ apiKey: 'key_1', webhookId: 'wh_1' });
    expect(mockUpdateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key_1',
        webhookId: 'wh_1',
        data: expect.objectContaining({
          email: 'billing@alusa.test',
          enabled: true,
          interrupted: false,
          authToken: 'token-1',
          sendType: 'SEQUENTIALLY',
          events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
        }),
      }),
    );
    expect(mockUpdateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { financeProfileId: 'fp_1' },
        data: expect.objectContaining({
          webhookAuthTokenHash: 'hash-1',
          previousWebhookAuthTokenHash: 'hash-old',
          previousWebhookAuthTokenExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'finance.webhook.config_repaired' }),
    );
  });

  it('repara webhook interrompido sem tentar removeBackoff quando não há penalização', async () => {
    mockListWebhooks
      .mockResolvedValueOnce({
        data: [
          {
            id: 'wh_1',
            name: 'Alusa - Webhook financeiro',
            url: 'https://app.alusa.test/api/webhooks/asaas',
            enabled: true,
            interrupted: true,
            hasAuthToken: true,
            sendType: 'SEQUENTIALLY',
            penalizedRequestsCount: 0,
            events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'wh_1',
            name: 'Alusa - Webhook financeiro',
            url: 'https://app.alusa.test/api/webhooks/asaas',
            enabled: true,
            interrupted: false,
            hasAuthToken: true,
            sendType: 'SEQUENTIALLY',
            penalizedRequestsCount: 0,
            events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
          },
        ],
      });

    const result = await repairWebhookConfigDrift({ contaId: 'conta-1', actor: { type: 'SYSTEM' } });

    expect(result.repaired).toBe(true);
    expect(mockRemoveWebhookBackoff).not.toHaveBeenCalled();
    expect(mockUpdateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key_1',
        webhookId: 'wh_1',
        data: expect.objectContaining({
          email: 'billing@alusa.test',
          interrupted: false,
        }),
      }),
    );
  });

  it('cria webhook ausente usando email de notificacao e persiste hash local', async () => {
    mockListWebhooks
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'wh_new',
            name: 'Alusa - Webhook financeiro',
            url: 'https://app.alusa.test/api/webhooks/asaas',
            enabled: true,
            interrupted: false,
            hasAuthToken: true,
            sendType: 'SEQUENTIALLY',
            penalizedRequestsCount: 0,
            events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
          },
        ],
      });
    mockCreateWebhook.mockResolvedValue({
      id: 'wh_new',
      name: 'Alusa - Webhook financeiro',
      url: 'https://app.alusa.test/api/webhooks/asaas',
      email: 'billing@alusa.test',
      enabled: true,
      interrupted: false,
      hasAuthToken: true,
      sendType: 'SEQUENTIALLY',
      penalizedRequestsCount: 0,
      events: ['PAYMENT_CONFIRMED', 'PAYMENT_PARTIALLY_REFUNDED'],
    });

    const result = await repairWebhookConfigDrift({ contaId: 'conta-1', actor: { type: 'SYSTEM' } });

    expect(result.repaired).toBe(true);
    expect(mockCreateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key_1',
        data: expect.objectContaining({
          name: 'Alusa - Webhook financeiro',
          url: 'https://app.alusa.test/api/webhooks/asaas',
          email: 'billing@alusa.test',
          authToken: 'token-1',
        }),
      }),
    );
    expect(mockUpdateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { financeProfileId: 'fp_1' },
        data: expect.objectContaining({
          webhookAuthTokenHash: 'hash-1',
          previousWebhookAuthTokenHash: 'hash-old',
          previousWebhookAuthTokenExpiresAt: expect.any(Date),
        }),
      }),
    );
  });
});
