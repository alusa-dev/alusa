/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const runContext = { startedAt: 1_760_000_000_000, correlationId: 'run-correlation-test' };
  return {
    runContext,
    startJobRun: vi.fn(() => runContext),
    logJobResult: vi.fn(),
    logJobFailure: vi.fn(),
    resolveTenantScope: vi.fn(),
    runWebhookQueuePreflight: vi.fn(),
    processAsaasWebhookQueueWithInbox: vi.fn(),
    drainFinanceWebhookSideEffectOutbox: vi.fn(),
    ensureEventAsaasPaymentProviderRegistered: vi.fn(),
  };
});

vi.mock('@sentry/nextjs', () => ({
  startSpan: (_options: unknown, callback: () => unknown) => callback(),
}));
vi.mock('@alusa/finance', () => ({
  FINANCE_SIDE_EFFECT_TYPES: ['KNOWN_EFFECT'],
  drainFinanceWebhookSideEffectOutbox: mocks.drainFinanceWebhookSideEffectOutbox,
  processAsaasWebhookQueueWithInbox: mocks.processAsaasWebhookQueueWithInbox,
  runWebhookQueuePreflight: mocks.runWebhookQueuePreflight,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: mocks.startJobRun,
  logJobResult: mocks.logJobResult,
  logJobFailure: mocks.logJobFailure,
}));
vi.mock('@/src/server/events/register-event-asaas-payment-provider', () => ({
  ensureEventAsaasPaymentProviderRegistered: mocks.ensureEventAsaasPaymentProviderRegistered,
}));

import { GET } from '../route';

const preflightResult = () => ({
  stuck: { recovered: 0, ids: ['private-webhook-id'], generatedAt: new Date(0) },
  exhausted: { marked: 0, ids: ['private-dlq-id'], generatedAt: new Date(0) },
  generatedAt: new Date(0),
});

const processedResult = () => ({
  attempted: 0,
  processed: 0,
  failed: 0,
  skipped: 0,
  workerId: 'private-worker-id',
  processedPayments: [{
    contaId: 'private-conta-id',
    event: 'PAYMENT_CONFIRMED',
    eventId: 'private-event-id',
    asaasPaymentId: 'private-payment-id',
    asaasSubscriptionId: null,
    occurredAt: null,
    payload: { token: 'private-payload' },
  }],
});

describe('GET /api/jobs/process-finance-webhooks observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenantScope.mockResolvedValue({ ok: true, contaId: 'tenant-a', isCron: true });
    mocks.runWebhookQueuePreflight.mockResolvedValue(preflightResult());
    mocks.processAsaasWebhookQueueWithInbox.mockResolvedValue(processedResult());
    mocks.drainFinanceWebhookSideEffectOutbox.mockResolvedValue({ attempted: 0, processed: 0, failed: 0 });
  });

  it('propagates the start context and records confirmed queue work with safe counters', async () => {
    mocks.processAsaasWebhookQueueWithInbox.mockResolvedValue({
      ...processedResult(), attempted: 1, processed: 1,
    });

    const response = await GET(new Request('http://localhost/api/jobs/process-finance-webhooks'));

    expect(response.status).toBe(200);
    expect(mocks.startJobRun).toHaveBeenCalledWith('process-finance-webhooks');
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'process-finance-webhooks',
      mocks.runContext,
      expect.objectContaining({ processed: 1, failed: 0, recovered: 0, marked: 0 }),
      expect.objectContaining({ workStatus: 'worked', partialFailure: false }),
    );
    expect(JSON.stringify(mocks.logJobResult.mock.calls[0])).not.toMatch(
      /private-(?:webhook-id|dlq-id|worker-id|conta-id|event-id|payment-id|payload)/,
    );
  });

  it('keeps zero counts unknown when the service contract does not prove every stage was empty', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/process-finance-webhooks'));

    expect(response.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'process-finance-webhooks',
      mocks.runContext,
      expect.objectContaining({ processed: 0, failed: 0, skipped: 0, sideEffectsProcessed: 0 }),
      expect.objectContaining({ workStatus: 'unknown', partialFailure: false }),
    );
    expect(JSON.stringify(mocks.logJobResult.mock.calls[0])).not.toMatch(
      /private-(?:webhook-id|dlq-id|worker-id|conta-id|event-id|payment-id|payload)/,
    );
  });

  it('marks returned item failures as partial failure while retaining safe counts', async () => {
    mocks.processAsaasWebhookQueueWithInbox.mockResolvedValue({
      ...processedResult(), attempted: 2, processed: 1, failed: 1,
    });
    mocks.drainFinanceWebhookSideEffectOutbox.mockResolvedValue({ attempted: 1, processed: 0, failed: 1 });

    const response = await GET(new Request('http://localhost/api/jobs/process-finance-webhooks'));

    expect(response.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'process-finance-webhooks',
      mocks.runContext,
      expect.objectContaining({ processed: 1, failed: 1, sideEffectsProcessed: 0, sideEffectsFailed: 1 }),
      expect.objectContaining({ workStatus: 'worked', partialFailure: true }),
    );
    expect(JSON.stringify(mocks.logJobResult.mock.calls[0])).not.toMatch(
      /private-(?:webhook-id|dlq-id|worker-id|conta-id|event-id|payment-id|payload)/,
    );
  });

  const recoveryCases: [
    string,
    { stuck?: { recovered: number }; exhausted?: { marked: number } },
    number,
    number,
  ][] = [
    ['stuck recovery', { stuck: { recovered: 1 } }, 1, 0],
    ['exhausted recovery', { exhausted: { marked: 1 } }, 0, 1],
  ];

  it.each(recoveryCases)('classifies %s as useful work with only safe counters', async (_label, recovery, recovered, marked) => {
    mocks.runWebhookQueuePreflight.mockResolvedValue({
      ...preflightResult(),
      ...recovery,
    });

    const response = await GET(new Request('http://localhost/api/jobs/process-finance-webhooks'));

    expect(response.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'process-finance-webhooks',
      mocks.runContext,
      expect.objectContaining({
        processed: 0,
        failed: 0,
        recovered,
        marked,
      }),
      expect.objectContaining({ workStatus: 'worked', partialFailure: false }),
    );
    expect(JSON.stringify(mocks.logJobResult.mock.calls[0])).not.toMatch(
      /private-(?:webhook-id|dlq-id|worker-id|conta-id|event-id|payment-id|payload)/,
    );
  });
});
