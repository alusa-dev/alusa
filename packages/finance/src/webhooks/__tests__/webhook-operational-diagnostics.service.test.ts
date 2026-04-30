import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFindFirst,
  mockCount,
  mockLoadCreds,
  mockGetQueueMetrics,
  mockDetectWebhookGaps,
  mockEvaluateRetentionAlert,
  mockGetWebhookHealthStatus,
  mockGetWebhookConfigDriftStatus,
  mockCalculateRegistryMetrics,
  mockEvaluateWebhookSLOs,
  mockInspectWebhookUrlRuntimeStatus,
  mockInspectWebhookProcessingRuntimeStatus,
} = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCount: vi.fn(),
  mockLoadCreds: vi.fn(),
  mockGetQueueMetrics: vi.fn(),
  mockDetectWebhookGaps: vi.fn(),
  mockEvaluateRetentionAlert: vi.fn(),
  mockGetWebhookHealthStatus: vi.fn(),
  mockGetWebhookConfigDriftStatus: vi.fn(),
  mockCalculateRegistryMetrics: vi.fn(),
  mockEvaluateWebhookSLOs: vi.fn(),
  mockInspectWebhookUrlRuntimeStatus: vi.fn(),
  mockInspectWebhookProcessingRuntimeStatus: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mockLoadCreds,
  prisma: {
    asaasAccount: {
      findFirst: mockFindFirst,
    },
    webhookAsaas: {
      count: mockCount,
    },
  },
}));

vi.mock('../webhook-reconciliation.service', () => ({
  getWebhookQueueMetrics: mockGetQueueMetrics,
  detectWebhookGaps: mockDetectWebhookGaps,
  evaluateRetentionAlert: mockEvaluateRetentionAlert,
}));

vi.mock('../webhook-health.service', () => ({
  getWebhookHealthStatus: mockGetWebhookHealthStatus,
}));

vi.mock('../webhook-config-drift.service', () => ({
  getWebhookConfigDriftStatus: mockGetWebhookConfigDriftStatus,
}));

vi.mock('../webhook-observability.service', () => ({
  calculateRegistryMetrics: mockCalculateRegistryMetrics,
  evaluateWebhookSLOs: mockEvaluateWebhookSLOs,
}));

vi.mock('../webhook-runtime-config', () => ({
  inspectWebhookUrlRuntimeStatus: mockInspectWebhookUrlRuntimeStatus,
  inspectWebhookProcessingRuntimeStatus: mockInspectWebhookProcessingRuntimeStatus,
}));

import { getWebhookOperationalDiagnostics } from '../webhook-operational-diagnostics.service';

describe('getWebhookOperationalDiagnostics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      FEATURE_ASAAS: 'true',
      ASAAS_WEBHOOK_AUTH_TOKEN_SECRET: 'secret',
    };

    mockFindFirst.mockResolvedValue({
      asaasAccountId: 'acc_1',
      financeProfileId: 'fp_1',
      status: 'APPROVED',
      webhookAuthTokenHash: 'hash_1',
    });
    mockCount.mockResolvedValue(0);
    mockLoadCreds.mockResolvedValue({ apiKey: 'key_1' });
    mockGetQueueMetrics.mockResolvedValue({
      contaId: 'conta-1',
      backlog: 0,
      pending: 0,
      processing: 0,
      errored: 0,
      processed: 10,
      highRetryBacklog: 0,
      stuckProcessing: 0,
      oldestPendingAt: null,
      lagSeconds: null,
      generatedAt: new Date('2026-03-27T00:00:00.000Z'),
    });
    mockDetectWebhookGaps.mockResolvedValue({
      chargesWithMissingFinalStatus: [],
      subscriptionsWithMissingEvents: [],
    });
    mockEvaluateRetentionAlert.mockReturnValue(null);
    mockGetWebhookHealthStatus.mockResolvedValue({
      contaId: 'conta-1',
      asaasAccountId: 'acc_1',
      webhooks: [{ id: 'wh_1', url: 'https://public.example.com/api/webhooks/asaas', enabled: true, interrupted: false }],
      hasInterrupted: false,
    });
    mockGetWebhookConfigDriftStatus.mockResolvedValue({
      contaId: 'conta-1',
      asaasAccountId: 'acc_1',
      financeProfileId: 'fp_1',
      expected: {
        name: 'Alusa - Webhook financeiro',
        url: 'https://public.example.com/api/webhooks/asaas',
        normalizedUrl: 'https://public.example.com/api/webhooks/asaas',
        sendType: 'SEQUENTIALLY',
        events: ['PAYMENT_CONFIRMED'],
        authToken: 'token',
        authTokenHash: 'hash_1',
      },
      remote: {
        webhookId: 'wh_1',
        url: 'https://public.example.com/api/webhooks/asaas',
        enabled: true,
        interrupted: false,
        hasAuthToken: true,
        sendType: 'SEQUENTIALLY',
        penalizedRequestsCount: 0,
        events: ['PAYMENT_CONFIRMED'],
      },
      drift: {
        remoteMissing: false,
        urlMismatch: false,
        disabled: false,
        interrupted: false,
        missingAuthToken: false,
        sendTypeMismatch: false,
        eventsMismatch: false,
        localHashMismatch: false,
        penalized: false,
        missingEvents: [],
        extraEvents: [],
      },
      canRepair: true,
    });
    mockCalculateRegistryMetrics.mockReturnValue({
      totalEvents: 10,
      handledEvents: 10,
      unhandledEvents: 0,
      criticalEvents: 5,
      unhandledCritical: 0,
      byCategory: {},
      healthStatus: 'HEALTHY',
      lastUpdated: '2026-03-27T00:00:00.000Z',
    });
    mockEvaluateWebhookSLOs.mockReturnValue({
      ok: true,
      violations: [],
      thresholds: {
        maxLagSeconds: 300,
        maxBacklog: 500,
        maxErrorRate: 0.05,
        maxExhausted: 10,
      },
      evaluatedAt: '2026-03-27T00:00:00.000Z',
    });
    mockInspectWebhookUrlRuntimeStatus.mockReturnValue({
      configured: true,
      source: 'ASAAS_WEBHOOK_PUBLIC_BASE_URL',
      baseUrl: 'https://public.example.com',
      webhookUrl: 'https://public.example.com/api/webhooks/asaas',
      publicHttps: true,
      error: null,
    });
    mockInspectWebhookProcessingRuntimeStatus.mockReturnValue({
      mode: 'QUEUE',
      useAsyncQueue: true,
      inlineDrain: true,
      isProduction: false,
      warnings: [],
    });
  });

  it('retorna OK quando não há sinais operacionais de risco', async () => {
    const result = await getWebhookOperationalDiagnostics({
      contaId: 'conta-1',
      includeGaps: true,
      windowDays: 7,
    });

    expect(result.status).toBe('OK');
    expect(result.recommendations).toEqual([]);
    expect(result.queue.exhausted).toBe(0);
    expect(result.local.hasSubaccountCredentials).toBe(true);
  });

  it('eleva status para ERROR quando encontra problemas críticos de webhook', async () => {
    process.env.FEATURE_ASAAS = 'false';
    delete process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET;

    mockFindFirst.mockResolvedValue(null);
    mockLoadCreds.mockResolvedValue(null);
    mockCount.mockResolvedValue(3);
    mockGetQueueMetrics.mockResolvedValue({
      contaId: 'conta-1',
      backlog: 5,
      pending: 1,
      processing: 1,
      errored: 2,
      processed: 0,
      highRetryBacklog: 2,
      stuckProcessing: 1,
      oldestPendingAt: new Date('2026-03-20T00:00:00.000Z'),
      lagSeconds: 60 * 60 * 24 * 8,
      generatedAt: new Date('2026-03-27T00:00:00.000Z'),
    });
    mockEvaluateRetentionAlert.mockReturnValue({
      level: 'HIGH',
      lagSeconds: 60 * 60 * 24 * 8,
      oldestPendingAt: new Date('2026-03-20T00:00:00.000Z'),
      backlog: 5,
      contaId: 'conta-1',
      message: 'Webhook queue lag 8d',
    });
    mockGetWebhookHealthStatus.mockResolvedValue(null);
    mockGetWebhookConfigDriftStatus.mockResolvedValue({
      contaId: 'conta-1',
      asaasAccountId: 'acc_1',
      financeProfileId: 'fp_1',
      expected: {
        name: 'Alusa - Webhook financeiro',
        url: 'https://public.example.com/api/webhooks/asaas',
        normalizedUrl: 'https://public.example.com/api/webhooks/asaas',
        sendType: 'SEQUENTIALLY',
        events: ['PAYMENT_CONFIRMED'],
        authToken: 'token',
        authTokenHash: 'hash_1',
      },
      remote: {
        webhookId: null,
        url: null,
        enabled: false,
        interrupted: false,
        hasAuthToken: false,
        sendType: null,
        penalizedRequestsCount: 0,
        events: [],
      },
      drift: {
        remoteMissing: true,
        urlMismatch: false,
        disabled: false,
        interrupted: false,
        missingAuthToken: false,
        sendTypeMismatch: false,
        eventsMismatch: false,
        localHashMismatch: false,
        penalized: false,
        missingEvents: [],
        extraEvents: [],
      },
      canRepair: false,
    });
    mockCalculateRegistryMetrics.mockReturnValue({
      totalEvents: 10,
      handledEvents: 8,
      unhandledEvents: 2,
      criticalEvents: 5,
      unhandledCritical: 1,
      byCategory: {},
      healthStatus: 'CRITICAL',
      lastUpdated: '2026-03-27T00:00:00.000Z',
    });
    mockEvaluateWebhookSLOs.mockReturnValue({
      ok: false,
      violations: [
        {
          metric: 'lag_seconds',
          threshold: 300,
          actual: 60 * 60 * 24 * 8,
          severity: 'critical',
          message: 'Queue lag exceeded',
        },
      ],
      thresholds: {
        maxLagSeconds: 300,
        maxBacklog: 500,
        maxErrorRate: 0.05,
        maxExhausted: 10,
      },
      evaluatedAt: '2026-03-27T00:00:00.000Z',
    });
    mockInspectWebhookUrlRuntimeStatus.mockReturnValue({
      configured: true,
      source: 'NEXT_PUBLIC_APP_URL',
      baseUrl: 'http://localhost:3000',
      webhookUrl: 'http://localhost:3000/api/webhooks/asaas',
      publicHttps: false,
      error: 'NEXT_PUBLIC_APP_URL deve usar https.',
    });
    mockInspectWebhookProcessingRuntimeStatus.mockReturnValue({
      mode: 'SYNC',
      useAsyncQueue: false,
      inlineDrain: true,
      isProduction: true,
      warnings: [
        {
          code: 'PRODUCTION_SYNC_OVERRIDE_ENABLED',
          severity: 'critical',
          message: 'sync override',
        },
      ],
    });
    mockDetectWebhookGaps.mockResolvedValue({
      chargesWithMissingFinalStatus: [{ id: 'c1', asaasPaymentId: 'pay_1', status: 'PENDENTE', dueDate: null, lastWebhookAt: null }],
      subscriptionsWithMissingEvents: [],
    });

    const result = await getWebhookOperationalDiagnostics({
      contaId: 'conta-1',
      includeGaps: true,
    });

    expect(result.status).toBe('ERROR');
    expect(result.recommendations.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'FEATURE_ASAAS_DISABLED',
        'WEBHOOK_SECRET_MISSING',
        'WEBHOOK_PUBLIC_URL_INVALID',
        'SUBACCOUNT_CREDENTIALS_MISSING',
        'ASAAS_ACCOUNT_NOT_CONNECTED',
        'REMOTE_WEBHOOK_MISSING',
        'WEBHOOK_DLQ_PRESENT',
        'WEBHOOK_RETENTION_RISK',
        'WEBHOOK_GAPS_DETECTED',
        'WEBHOOK_REGISTRY_CRITICAL_GAP',
      ]),
    );
  });
});
