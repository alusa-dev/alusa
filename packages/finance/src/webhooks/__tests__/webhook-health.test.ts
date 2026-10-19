import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTelemetrySink, type TelemetryMetric } from '@alusa/observability';

let unsubscribeTelemetry: (() => void) | undefined;

// ── Hoisted mocks ────────────────────────────────────────────────────────

const {
  mockFindMany,
  mockListWebhooks,
  mockRemoveBackoff,
  mockAuditRecord,
  mockLoadCreds,
  mockCreateNotification,
  mockNotificationFindFirst,
  mockExecuteRaw,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockListWebhooks: vi.fn(),
  mockRemoveBackoff: vi.fn(),
  mockAuditRecord: vi.fn().mockResolvedValue(undefined),
  mockLoadCreds: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockNotificationFindFirst: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    $executeRaw: mockExecuteRaw,
    asaasAccount: { findMany: mockFindMany, findFirst: vi.fn() },
    notification: {
      findFirst: mockNotificationFindFirst,
    },
  },
  loadAsaasCredentials: mockLoadCreds,
}));

vi.mock('@alusa/lib/services/notifications.service', () => ({
  createNotification: mockCreateNotification,
}));

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    constructor(public status: number, message = 'Asaas error') {
      super(message);
    }
  },
  listWebhooks: mockListWebhooks,
  removeWebhookBackoff: mockRemoveBackoff,
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: mockAuditRecord },
}));

import { checkWebhookHealth } from '../webhook-health.service';
import { alertService } from '../../foundation/alert-channel';

beforeEach(() => {
  vi.clearAllMocks();

  mockLoadCreds.mockResolvedValue({
    apiKey: 'sandbox_key',
    apiKeyStatus: 'CONNECTED',
    source: 'asaasCredentialRef' as const,
  });
  mockCreateNotification.mockResolvedValue({
    notificationId: 'notification-1',
    created: true,
    recipientCount: 1,
  });
  mockNotificationFindFirst.mockResolvedValue({ metadata: {} });
  mockExecuteRaw.mockResolvedValue(1);
});

afterEach(() => {
  unsubscribeTelemetry?.();
  unsubscribeTelemetry = undefined;
});

afterEach(() => {
  unsubscribeTelemetry?.();
  unsubscribeTelemetry = undefined;
});

describe('checkWebhookHealth', () => {
  it('retorna resultado limpo quando nenhum webhook está interrompido', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);

    mockListWebhooks.mockResolvedValue({
      data: [
        { id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: false },
      ],
    });

    const result = await checkWebhookHealth();

    expect(result.checkedAccounts).toBe(1);
    expect(result.interruptedFound).toBe(0);
    expect(result.recoveredSuccessfully).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('emite métricas agregadas sem identificadores de conta', async () => {
    const metrics: TelemetryMetric[] = [];
    unsubscribeTelemetry = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });
    mockFindMany.mockResolvedValue([
      {
        id: 'internal-account-id',
        asaasAccountId: 'asaas-account-secret-id',
        financeProfile: { contaId: 'tenant-sensitive-id', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);
    mockListWebhooks.mockResolvedValue({ data: [] });

    await checkWebhookHealth();

    expect(metrics.map((metric) => metric.name)).toContain('finance.webhook_health.accounts_checked');
    expect(metrics.every((metric) => metric.dimensions?.provider === 'asaas')).toBe(true);
    expect(metrics.every((metric) => metric.dimensions?.['operation.name'] === 'health_check')).toBe(true);
    expect(JSON.stringify(metrics)).not.toContain('tenant-sensitive-id');
    expect(JSON.stringify(metrics)).not.toContain('asaas-account-secret-id');
  });

  it('detecta webhook interrompido e tenta recovery', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);

    mockListWebhooks
      .mockResolvedValueOnce({
        data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: false }],
      });

    mockRemoveBackoff.mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com',
      enabled: true,
      interrupted: false,
    });

    const result = await checkWebhookHealth({ autoRecover: true });

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveredSuccessfully).toBe(1);
    expect(result.recoveryFailed).toBe(0);
    expect(mockRemoveBackoff).toHaveBeenCalledWith({
      apiKey: 'sandbox_key',
      webhookId: 'wh-1',
    });
    expect(mockAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.backoff_removed',
        metadata: expect.objectContaining({ recovered: true }),
      }),
    );
  });

  it('reporta falha quando removeBackoff não resolve interrupted', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);

    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
    });

    mockRemoveBackoff.mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com',
      enabled: true,
      interrupted: true,
    });

    const result = await checkWebhookHealth({ autoRecover: true });

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveryFailed).toBe(1);
    expect(result.recoveredSuccessfully).toBe(0);
  });

  it('não tenta recovery quando autoRecover=false', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);

    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
    });

    const result = await checkWebhookHealth({ autoRecover: false });

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveredSuccessfully).toBe(0);
    expect(mockRemoveBackoff).not.toHaveBeenCalled();
  });

  it('mantém recovery opt-in e não tenta por padrão', async () => {
    const alertSpy = vi.spyOn(alertService, 'alertInterruptedQueue').mockResolvedValue({ channelResults: [] });
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT' } },
      },
    ]);
    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true, penalizedRequestsCount: 4 }],
    });

    const result = await checkWebhookHealth();

    expect(result.interruptedFound).toBe(1);
    expect(result.recoveredSuccessfully).toBe(0);
    expect(mockRemoveBackoff).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('conta-1', ['wh-1']);
  });

  it('não recupera backoff de conta externa mesmo com autoRecover explícito', async () => {
    const alertSpy = vi.spyOn(alertService, 'alertInterruptedQueue').mockResolvedValue({ channelResults: [] });
    mockFindMany.mockResolvedValue([{
      id: 'acc-external',
      asaasAccountId: 'asaas-ext-1',
      financeProfile: { contaId: 'conta-ext', conta: { financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT' } },
    }]);
    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-ext', url: 'https://example.com', enabled: true, interrupted: true, penalizedRequestsCount: 5 }],
    });

    const result = await checkWebhookHealth({ contaId: 'conta-ext', autoRecover: true });

    expect(result).toMatchObject({ checkedAccounts: 1, interruptedFound: 1, recoveredSuccessfully: 0, recoveryFailed: 0 });
    expect(result.errors).toEqual([]);
    expect(mockRemoveBackoff).not.toHaveBeenCalled();
    expect(mockAuditRecord).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('conta-ext', ['wh-ext']);
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-ext',
      message: expect.stringContaining('Intervenção manual necessária.'),
    }));
  });

  it('repete alerta após falha de canal e para após persistir sucesso', async () => {
    const alertSpy = vi.spyOn(alertService, 'alertInterruptedQueue')
      .mockResolvedValueOnce({ channelResults: [
        { channel: 'console', success: true },
        { channel: 'slack', success: false },
      ] })
      .mockResolvedValueOnce({ channelResults: [
        { channel: 'console', success: true },
        { channel: 'slack', success: true },
      ] });
    mockFindMany.mockResolvedValue([{
      id: 'acc-1',
      asaasAccountId: 'ext-acc-1',
      financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
    }]);
    mockListWebhooks.mockResolvedValue({
      data: [{ id: 'wh-1', url: 'https://example.com', enabled: true, interrupted: true }],
    });
    mockCreateNotification
      .mockResolvedValueOnce({ notificationId: 'notification-1', created: true })
      .mockResolvedValue({ notificationId: 'notification-1', created: false });
    mockNotificationFindFirst
      .mockResolvedValueOnce({ metadata: {} })
      .mockResolvedValueOnce({ metadata: { externalAlertDelivery: { channels: [
        { channel: 'console', success: true },
        { channel: 'slack', success: false },
      ] } } })
      .mockResolvedValueOnce({ metadata: { externalAlertDelivery: { channels: [
        { channel: 'console', success: true },
        { channel: 'slack', success: true },
      ] } } });

    await checkWebhookHealth();
    await checkWebhookHealth();
    await checkWebhookHealth();

    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    const savedStateQuery = mockExecuteRaw.mock.calls[1]?.[0];
    expect(savedStateQuery.sql).toContain('jsonb_set');
    expect(savedStateQuery.sql).toContain('AND "contaId" =');
    expect(savedStateQuery.values).toContain('notification-1');
    expect(savedStateQuery.values).toContain('conta-1');
  });

  it('é fail-safe quando loadAsaasCredentials retorna null', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);

    mockLoadCreds.mockResolvedValue(null);

    const result = await checkWebhookHealth();

    expect(result.checkedAccounts).toBe(1);
    expect(result.interruptedFound).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('é fail-safe quando listWebhooks falha', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'acc-1',
        asaasAccountId: 'ext-acc-1',
        financeProfile: { contaId: 'conta-1', conta: { financeIntegrationMode: 'WHITELABEL_BAAS' } },
      },
    ]);

    mockListWebhooks.mockRejectedValue(new Error('API timeout'));

    const result = await checkWebhookHealth();

    expect(result.checkedAccounts).toBe(1);
    expect(result.interruptedFound).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('API timeout');
  });
});
