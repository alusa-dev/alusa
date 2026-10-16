/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  afterMock,
  resolveTenantScopeMock,
  runWebhookSchedulerMock,
  logJobResultMock,
  logJobFailureMock,
  findNotificationsMock,
  dispatchNotificationMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  resolveTenantScopeMock: vi.fn(),
  runWebhookSchedulerMock: vi.fn(),
  logJobResultMock: vi.fn(),
  logJobFailureMock: vi.fn(),
  findNotificationsMock: vi.fn(),
  dispatchNotificationMock: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
  after: afterMock,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: resolveTenantScopeMock }));
vi.mock('@alusa/finance', () => ({ runWebhookScheduler: runWebhookSchedulerMock }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResult: logJobResultMock,
  logJobFailure: logJobFailureMock,
}));
vi.mock('@/src/server/events/event-ticket-whatsapp-outbox.service', () => ({
  findRecentlyCreatedPendingEventTicketWhatsAppNotifications: findNotificationsMock,
  dispatchEventTicketWhatsAppNotification: dispatchNotificationMock,
}));

import { GET } from '../route';

const schedulerResult = {
  executedAt: new Date('2026-10-16T00:00:00.000Z'),
  completedAt: new Date('2026-10-16T00:00:01.000Z'),
  totalDurationMs: 1000,
  steps: [{ step: 'drift_check', ok: true, durationMs: 10, detail: {} }],
  hasErrors: false,
  retentionAlert: null,
  slo: null,
};

describe('GET /api/jobs/webhook-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScopeMock.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    runWebhookSchedulerMock.mockResolvedValue(schedulerResult);
    findNotificationsMock.mockResolvedValue([]);
  });

  it('retorna 200 para sucesso e para skip por lock', async () => {
    const success = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ success: true, result: { hasErrors: false } });

    runWebhookSchedulerMock.mockResolvedValue({
      ...schedulerResult,
      skippedDueToLock: true,
      steps: [],
      hasErrors: false,
    });
    const skipped = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    expect(skipped.status).toBe(200);
    expect(await skipped.json()).toMatchObject({
      success: true,
      result: { skippedDueToLock: true, steps: [], hasErrors: false },
    });
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it('exige evidência de todos os estágios, registra o outbox elegível e rejeita detalhes sensíveis', async () => {
    const completeSteps = [
      { step: 'recover_stuck', ok: true, durationMs: 1, detail: { recovered: 0 } },
      { step: 'drain_queue', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0 } },
      { step: 'reconcile_side_effect_outbox', ok: true, durationMs: 1, detail: { scanned: 8, eligible: 0, enqueued: 0, skipped: 0, contaId: 'private-tenant' } },
      { step: 'drain_side_effects', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0, failed: 0 } },
      { step: 'mark_exhausted', ok: true, durationMs: 1, detail: { marked: 0 } },
      { step: 'health_check', ok: true, durationMs: 1, detail: { checkedAccounts: 0, interruptedFound: 0, recoveredSuccessfully: 0, recoveryFailed: 0 } },
      { step: 'drift_check', ok: true, durationMs: 1, detail: { accountsChecked: 0, driftsFound: 0, driftsRepaired: 0 } },
      { step: 'archive', ok: true, durationMs: 1, detail: { selected: 0, archived: 0, deletedFromHot: 0 } },
    ];
    runWebhookSchedulerMock.mockResolvedValue({
      ...schedulerResult,
      steps: completeSteps,
    });
    const emptyResponse = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    expect(logJobResultMock).toHaveBeenLastCalledWith('webhook-scheduler', expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
    const emptyBody = await emptyResponse.json();
    expect(emptyBody.result.steps[2].detail).toEqual({ scanned: 8, eligible: 0, enqueued: 0, skipped: 0 });
    expect(emptyBody.result.steps[7].detail).toEqual({ selected: 0, archived: 0, deletedFromHot: 0 });
    expect(JSON.stringify(emptyBody)).not.toContain('private-tenant');

    runWebhookSchedulerMock.mockResolvedValue({
      ...schedulerResult,
      steps: completeSteps.map((step) => step.step === 'reconcile_side_effect_outbox'
        ? { ...step, detail: { ...step.detail, eligible: 1, enqueued: 1, payload: { email: 'private@example.com' } } }
        : step),
    });
    const workedResponse = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    expect(logJobResultMock).toHaveBeenLastCalledWith('webhook-scheduler', expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    const workedBody = await workedResponse.json();
    expect(workedBody.result.steps[2].detail).toMatchObject({ eligible: 1, enqueued: 1 });
    expect(JSON.stringify(workedBody)).not.toContain('private@example.com');

    runWebhookSchedulerMock.mockResolvedValue(schedulerResult);
    await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    expect(logJobResultMock).toHaveBeenLastCalledWith('webhook-scheduler', expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }), expect.any(Object), expect.objectContaining({ workStatus: 'unknown' }));
  });

  it('classifica como vazio o ciclo normal do cron quando os estágios opcionais estão intencionalmente pulados', async () => {
    runWebhookSchedulerMock.mockResolvedValue({
      ...schedulerResult,
      steps: [
        { step: 'recover_stuck', ok: true, durationMs: 1, detail: { recovered: 0 } },
        { step: 'drain_queue', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0 } },
        { step: 'reconcile_side_effect_outbox', ok: true, durationMs: 1, detail: { scanned: 0, eligible: 0, enqueued: 0, skipped: 0 } },
        { step: 'drain_side_effects', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0, failed: 0 } },
        { step: 'mark_exhausted', ok: true, durationMs: 1, detail: { marked: 0 } },
      ],
    });

    const response = await GET(new Request(
      'http://localhost/api/jobs/webhook-scheduler?drainLimit=500&skipArchive=true&skipHealthCheck=true&skipDriftCheck=true',
    ));

    expect(response.status).toBe(200);
    expect(logJobResultMock).toHaveBeenLastCalledWith(
      'webhook-scheduler',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'empty' }),
    );
    expect(runWebhookSchedulerMock).toHaveBeenLastCalledWith(expect.objectContaining({
      drainLimit: 500,
      skipArchive: true,
      skipHealthCheck: true,
      skipDriftCheck: true,
      enableReconciliation: false,
    }));
  });

  it('classifica como unknown quando há um estágio extra inesperado sem evidência completa', async () => {
    const completeSteps = [
      { step: 'recover_stuck', ok: true, durationMs: 1, detail: { recovered: 0 } },
      { step: 'drain_queue', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0 } },
      { step: 'reconcile_side_effect_outbox', ok: true, durationMs: 1, detail: { scanned: 0, eligible: 0, enqueued: 0, skipped: 0 } },
      { step: 'drain_side_effects', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0, failed: 0 } },
      { step: 'mark_exhausted', ok: true, durationMs: 1, detail: { marked: 0 } },
      { step: 'health_check', ok: true, durationMs: 1, detail: { checkedAccounts: 0, interruptedFound: 0 } },
      { step: 'drift_check', ok: true, durationMs: 1, detail: { accountsChecked: 0, driftsFound: 0 } },
      { step: 'archive', ok: true, durationMs: 1, detail: { selected: 0, archived: 0 } },
      { step: 'future_stage', ok: true, durationMs: 1, detail: {} },
    ];
    runWebhookSchedulerMock.mockResolvedValue({ ...schedulerResult, steps: completeSteps });

    const response = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));

    expect(response.status).toBe(200);
    expect(logJobResultMock).toHaveBeenLastCalledWith(
      'webhook-scheduler',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'unknown' }),
    );
  });

  it('classifica como unknown quando falta estágio obrigatório apesar de haver trabalho em outra etapa', async () => {
    runWebhookSchedulerMock.mockResolvedValue({
      ...schedulerResult,
      steps: [
        { step: 'drain_queue', ok: true, durationMs: 1, detail: { attempted: 1, processed: 1 } },
        { step: 'reconcile_side_effect_outbox', ok: true, durationMs: 1, detail: { scanned: 0, eligible: 0, enqueued: 0, skipped: 0 } },
        { step: 'drain_side_effects', ok: true, durationMs: 1, detail: { attempted: 0, processed: 0, failed: 0 } },
        { step: 'mark_exhausted', ok: true, durationMs: 1, detail: { marked: 0 } },
        { step: 'health_check', ok: true, durationMs: 1, detail: { checkedAccounts: 0, interruptedFound: 0 } },
        { step: 'drift_check', ok: true, durationMs: 1, detail: { accountsChecked: 0, driftsFound: 0 } },
        { step: 'archive', ok: true, durationMs: 1, detail: { selected: 0, archived: 0 } },
      ],
    });

    await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));

    expect(logJobResultMock).toHaveBeenLastCalledWith(
      'webhook-scheduler',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'unknown' }),
    );
  });

  it('retorna falha HTTP estável quando uma ou mais etapas falham', async () => {
    runWebhookSchedulerMock.mockResolvedValue({
      ...schedulerResult,
      hasErrors: true,
      lock: { jobName: 'webhook-scheduler:private-tenant-id', workerId: 'private-worker-id' },
      steps: [{
        step: 'drain_queue',
        ok: false,
        durationMs: 10,
        error: 'provider secret detail',
        detail: { failed: 1, contaId: 'private-tenant', payload: { email: 'private@example.com' } },
      }],
    });

    const response = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: 'SCHEDULER_PARTIAL_FAILURE',
        message: 'Uma ou mais etapas do scheduler de webhooks falharam.',
      },
      result: { hasErrors: true },
    });
    expect(JSON.stringify(body)).not.toMatch(/provider secret detail|private-worker-id|private-tenant|private@example.com/);
    expect(body.result.steps[0].error).toBe('STEP_FAILED');
    expect(body.result.steps[0].detail).toEqual({ failed: 1 });
    expect(body.result.lock.workerId).toBeUndefined();
    expect(body.result.lock.jobName).toBe('webhook-scheduler');
    expect(logJobResultMock).toHaveBeenCalledWith(
      'webhook-scheduler',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }),
      expect.objectContaining({ hasErrors: true }),
      expect.objectContaining({ partialFailure: true }),
    );
  });

  it('aceita a invocação seguinte após 500 parcial e devolve o estado convergido', async () => {
    runWebhookSchedulerMock
      .mockResolvedValueOnce({
        ...schedulerResult,
        hasErrors: true,
        steps: [{ step: 'drain_queue', ok: false, durationMs: 10, error: 'QUEUE_ITEMS_FAILED', detail: { processed: 1, failed: 1 } }],
      })
      .mockResolvedValueOnce({
        ...schedulerResult,
        steps: [{ step: 'drain_queue', ok: true, durationMs: 8, detail: { processed: 1, failed: 0, skipped: 1 } }],
      });

    const first = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));
    const second = await GET(new Request('http://localhost/api/jobs/webhook-scheduler'));

    expect(first.status).toBe(500);
    expect((await first.json()).result.steps[0].detail).toEqual({ processed: 1, failed: 1 });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      success: true,
      result: { hasErrors: false, steps: [{ detail: { processed: 1, failed: 0, skipped: 1 } }] },
    });
    expect(runWebhookSchedulerMock).toHaveBeenCalledTimes(2);
  });
});
