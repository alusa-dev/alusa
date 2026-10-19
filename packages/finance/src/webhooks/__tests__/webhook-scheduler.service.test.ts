import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prismaMock,
  lockMock,
  recoveryMock,
  accountStatusMock,
  repairMock,
  archiveMock,
  queueMock,
  sideEffectDrainMock,
  sideEffectReconcileMock,
  healthMock,
  markExhaustedMock,
  reconcileMock,
  queueMetricsMock,
} = vi.hoisted(() => ({
  prismaMock: { asaasAccount: { findMany: vi.fn() } },
  lockMock: vi.fn(),
  recoveryMock: vi.fn(),
  accountStatusMock: vi.fn(),
  repairMock: vi.fn(),
  archiveMock: vi.fn(),
  queueMock: vi.fn(),
  sideEffectDrainMock: vi.fn(),
  sideEffectReconcileMock: vi.fn(),
  healthMock: vi.fn(),
  markExhaustedMock: vi.fn(),
  reconcileMock: vi.fn(),
  queueMetricsMock: vi.fn(),
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('../../foundation/webhook-job-lock.service', () => ({
  withWebhookJobLock: lockMock,
}));
vi.mock('../webhook-reconciliation.service', () => ({
  recoverStuckWebhooks: recoveryMock,
  getWebhookQueueMetrics: queueMetricsMock,
  archiveProcessedWebhooks: archiveMock,
  evaluateRetentionAlert: vi.fn().mockReturnValue(null),
  markExhaustedWebhooks: markExhaustedMock,
  reconcileWithAsaas: reconcileMock,
}));
vi.mock('../process-webhook-queue-with-inbox', () => ({
  processAsaasWebhookQueueWithInbox: queueMock,
}));
vi.mock('../finance-side-effect-outbox.service', () => ({
  drainFinanceWebhookSideEffectOutbox: sideEffectDrainMock,
  reconcileMissingBillingNotificationSideEffects: sideEffectReconcileMock,
}));
vi.mock('../webhook-health.service', () => ({ checkWebhookHealth: healthMock }));
vi.mock('../webhook-config-drift.service', () => ({
  getWebhookConfigDriftStatus: accountStatusMock,
  repairWebhookConfigDrift: repairMock,
}));
vi.mock('../webhook-observability.service', () => ({
  evaluateWebhookSLOs: vi.fn().mockReturnValue({}),
}));
vi.mock('../../foundation/operational-log', () => ({
  logFinanceOperationalEvent: vi.fn(),
}));

import { runWebhookHealthAndDriftMaintenance, runWebhookScheduler } from '../webhook-scheduler.service';

describe('runWebhookScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockMock.mockImplementation(async (_jobName, callback) => ({
      acquired: true,
      result: await callback(),
      jobName: 'webhook-scheduler:global',
      workerId: 'worker-test',
    }));
    recoveryMock.mockResolvedValue({ recovered: 0 });
    archiveMock.mockResolvedValue({ archived: 0 });
    repairMock.mockResolvedValue({ repaired: true });
    queueMock.mockResolvedValue({
      attempted: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
      workerId: 'worker-secret',
      processedPayments: [],
    });
    sideEffectDrainMock.mockResolvedValue({ attempted: 0, processed: 0, failed: 0 });
    sideEffectReconcileMock.mockResolvedValue({ inspected: 0 });
    markExhaustedMock.mockResolvedValue({ marked: 0 });
    reconcileMock.mockResolvedValue({
      asaasCalls: 0,
      errors: [],
      checkedPayments: 0,
      reconciledPayments: 0,
      paymentDrift: 0,
      checkedSubscriptions: 0,
      reconciledSubscriptions: 0,
      subscriptionDrift: 0,
      checkedInstallments: 0,
      installmentDrift: 0,
      storeSalesFulfilled: 0,
    });
    queueMetricsMock.mockResolvedValue({
      lagSeconds: 0,
      backlog: 0,
      errored: 0,
      processed: 0,
      exhausted: 0,
    });
    healthMock.mockResolvedValue({
      checkedAccounts: 0,
      interruptedFound: 0,
      recoveredSuccessfully: 0,
      recoveryFailed: 0,
      errors: [],
      executedAt: new Date(),
    });
    prismaMock.asaasAccount.findMany.mockResolvedValue([]);
    accountStatusMock.mockResolvedValue({ drift: {} });
  });

  it('continua na Conta B após falha da Conta A e executa a etapa posterior', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-a' } },
      { financeProfile: { contaId: 'conta-b' } },
    ]);
    accountStatusMock
      .mockRejectedValueOnce(new Error('provider secret detail'))
      .mockResolvedValueOnce({ drift: { disabled: true } });

    const result = await runWebhookScheduler({
      skipQueueDrain: true,
      skipHealthCheck: true,
    });

    expect(result.hasErrors).toBe(true);
    expect(result.steps.find((step) => step.step === 'drift_check')).toMatchObject({
      ok: false,
      detail: { accountsChecked: 2, accountFailures: 1 },
      error: 'DRIFT_ACCOUNT_FAILURES',
    });
    expect(result.steps.find((step) => step.step === 'recover_stuck')?.ok).toBe(true);
    expect(accountStatusMock).toHaveBeenNthCalledWith(1, 'conta-a');
    expect(accountStatusMock).toHaveBeenNthCalledWith(2, 'conta-b');
    expect(repairMock).toHaveBeenCalledWith({
      contaId: 'conta-b',
      actor: { type: 'SYSTEM' },
    });
    expect(archiveMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('provider secret detail');
  });

  it('termina normalmente quando as contas não apresentam falhas', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-a' } },
      { financeProfile: { contaId: 'conta-b' } },
    ]);

    const result = await runWebhookScheduler({
      skipQueueDrain: true,
    });

    expect(result.hasErrors).toBe(false);
    expect(result.steps.find((step) => step.step === 'drift_check')).toMatchObject({
      ok: true,
      detail: { accountsChecked: 2, driftsFound: 0, driftsRepaired: 0 },
    });
    expect(accountStatusMock).toHaveBeenCalledTimes(2);
    expect(result.steps.find((step) => step.step === 'health_check')?.ok).toBe(true);
    expect(archiveMock).toHaveBeenCalledOnce();
  });

  it('mantém drift externo visível como não suportado sem falhar o scheduler', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-externa' } },
    ]);
    accountStatusMock.mockResolvedValue({ drift: { interrupted: true, penalized: true } });
    repairMock.mockResolvedValue({
      repaired: false,
      reason: 'UNSUPPORTED_FEATURE',
      before: { repairSupported: false, drift: { interrupted: true, penalized: true } },
    });

    const result = await runWebhookScheduler({ skipQueueDrain: true, skipHealthCheck: true });

    expect(result.hasErrors).toBe(false);
    expect(result.steps.find((step) => step.step === 'drift_check')).toMatchObject({
      ok: true,
      detail: { accountsChecked: 1, driftsFound: 1, driftsRepaired: 0, unsupportedDrifts: 1 },
    });
    expect(accountStatusMock).toHaveBeenCalledWith('conta-externa');
    expect(repairMock).toHaveBeenCalledWith({
      contaId: 'conta-externa',
      actor: { type: 'SYSTEM' },
    });
    expect(archiveMock).toHaveBeenCalledOnce();
  });

  it('classifica rejeição de recurso Asaas como falha quando o repair era suportado', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-whitelabel' } },
    ]);
    accountStatusMock.mockResolvedValue({ drift: { disabled: true } });
    repairMock.mockResolvedValue({
      repaired: false,
      reason: 'UNSUPPORTED_FEATURE',
      before: { repairSupported: true, drift: { disabled: true } },
    });

    const result = await runWebhookScheduler({ skipQueueDrain: true, skipHealthCheck: true });

    expect(result.hasErrors).toBe(true);
    expect(result.steps.find((step) => step.step === 'drift_check')).toMatchObject({
      ok: false,
      error: 'DRIFT_ACCOUNT_FAILURES',
      detail: { accountsChecked: 1, accountFailures: 1 },
    });
  });

  it('expõe drift sem suporte como contagem de manutenção sem erro', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-externa' } },
    ]);
    accountStatusMock.mockResolvedValue({
      repairSupported: false,
      drift: { interrupted: true, penalized: true },
    });
    repairMock.mockResolvedValue({
      repaired: false,
      reason: 'UNSUPPORTED_FEATURE',
      before: { repairSupported: false },
    });

    const result = await runWebhookHealthAndDriftMaintenance({ autoRepair: false });

    expect(result).toMatchObject({
      accountsChecked: 1,
      driftsFound: 1,
      driftsRepaired: 0,
      unsupportedDrifts: 1,
      errors: [],
    });
    expect(repairMock).toHaveBeenCalledWith({
      contaId: 'conta-externa',
      actor: { type: 'SYSTEM' },
    });
  });

  it('reporta falha ao persistir drift não suportado', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-externa' } },
    ]);
    accountStatusMock.mockResolvedValue({
      repairSupported: false,
      drift: { interrupted: true },
    });
    repairMock.mockResolvedValue({
      repaired: false,
      reason: 'PROVIDER_ERROR',
      failureCategory: 'database_unavailable',
    });

    const result = await runWebhookHealthAndDriftMaintenance({ autoRepair: false });

    expect(result.unsupportedDrifts).toBe(0);
    expect(result.errors).toEqual([
      { contaId: 'conta-externa', error: 'database_unavailable' },
    ]);
  });

  it('reporta credenciais ausentes ao tentar reparar drift suportado', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-whitelabel' } },
    ]);
    accountStatusMock.mockResolvedValue({
      repairSupported: true,
      drift: { disabled: true },
    });
    repairMock.mockResolvedValue({
      repaired: false,
      reason: 'CREDENTIALS_MISSING',
      before: { repairSupported: true },
    });

    const result = await runWebhookHealthAndDriftMaintenance({ autoRepair: true });

    expect(result.errors).toEqual([
      { contaId: 'conta-whitelabel', error: 'CREDENTIALS_MISSING' },
    ]);
  });

  it('conta falha retornada pelo repair da Conta A e continua reparando a Conta B', async () => {
    prismaMock.asaasAccount.findMany.mockResolvedValue([
      { financeProfile: { contaId: 'conta-a' } },
      { financeProfile: { contaId: 'conta-b' } },
    ]);
    accountStatusMock.mockResolvedValue({ drift: { disabled: true } });
    repairMock
      .mockResolvedValueOnce({
        repaired: false,
        reason: 'PROVIDER_ERROR',
        failureCategory: 'private-provider-category',
        failureStatus: 503,
        failureDetails: [{ description: 'provider secret detail' }],
      })
      .mockResolvedValueOnce({ repaired: true, reason: 'REPAIRED' });

    const result = await runWebhookScheduler({
      skipQueueDrain: true,
      skipHealthCheck: true,
    });
    const driftStep = result.steps.find((step) => step.step === 'drift_check');

    expect(result.hasErrors).toBe(true);
    expect(driftStep).toMatchObject({
      ok: false,
      error: 'DRIFT_ACCOUNT_FAILURES',
      detail: { accountsChecked: 2, accountFailures: 1 },
    });
    expect(repairMock).toHaveBeenNthCalledWith(1, {
      contaId: 'conta-a',
      actor: { type: 'SYSTEM' },
    });
    expect(repairMock).toHaveBeenNthCalledWith(2, {
      contaId: 'conta-b',
      actor: { type: 'SYSTEM' },
    });
    expect(archiveMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(driftStep)).not.toMatch(/private-provider-category|provider secret detail|503/);
  });

  it('conta falhas de webhook no drain sem interromper etapas posteriores nem expor payload', async () => {
    queueMock.mockResolvedValue({
      attempted: 2,
      processed: 1,
      failed: 1,
      skipped: 0,
      workerId: 'private-worker-id',
      processedPayments: [{ contaId: 'private-tenant', asaasPaymentId: 'private-payment' }],
    });

    const result = await runWebhookScheduler({ skipHealthCheck: true, skipArchive: true });
    const drainStep = result.steps.find((step) => step.step === 'drain_queue');

    expect(result.hasErrors).toBe(true);
    expect(drainStep).toMatchObject({
      ok: false,
      error: 'QUEUE_ITEMS_FAILED',
      detail: { attempted: 2, processed: 1, failed: 1, skipped: 0 },
    });
    expect(JSON.stringify(drainStep)).not.toMatch(/private-worker-id|private-tenant|private-payment/);
    expect(result.steps.find((step) => step.step === 'reconcile_side_effect_outbox')?.ok).toBe(true);
    expect(markExhaustedMock).toHaveBeenCalledOnce();
  });

  it('converge em uma segunda execução após falha parcial sem reaplicar o item já concluído', async () => {
    const itemState = new Map([
      ['event-success', 'PENDING'],
      ['event-retry', 'PENDING'],
    ]);
    const effectApplications = new Map<string, number>();
    let queueInvocations = 0;
    queueMock.mockImplementation(async () => {
      queueInvocations += 1;
      let processed = 0;
      let failed = 0;
      let skipped = 0;

      for (const [eventId, status] of itemState) {
        if (status === 'PROCESSED') {
          skipped += 1;
          continue;
        }
        if (eventId === 'event-retry' && status === 'PENDING') {
          itemState.set(eventId, 'ERRO');
          failed += 1;
          continue;
        }

        itemState.set(eventId, 'PROCESSED');
        effectApplications.set(eventId, (effectApplications.get(eventId) ?? 0) + 1);
        processed += 1;
      }

      return { attempted: 2, processed, failed, skipped, processedPayments: [] };
    });

    const options = {
      skipHealthCheck: true,
      skipDriftCheck: true,
      skipArchive: true,
    };
    const first = await runWebhookScheduler(options);
    const second = await runWebhookScheduler(options);

    expect(first.hasErrors).toBe(true);
    expect(first.steps.find((step) => step.step === 'drain_queue')).toMatchObject({
      ok: false,
      error: 'QUEUE_ITEMS_FAILED',
      detail: { processed: 1, failed: 1 },
    });
    expect(second.hasErrors).toBe(false);
    expect(second.steps.find((step) => step.step === 'drain_queue')).toMatchObject({
      ok: true,
      detail: { processed: 1, failed: 0, skipped: 1 },
    });
    expect(queueInvocations).toBe(2);
    expect(effectApplications).toEqual(new Map([
      ['event-success', 1],
      ['event-retry', 1],
    ]));
  });

  it('conta falhas do side-effect drain e mantém processamento posterior', async () => {
    sideEffectDrainMock.mockResolvedValue({ attempted: 3, processed: 2, failed: 1 });

    const result = await runWebhookScheduler({ skipQueueDrain: true, skipHealthCheck: true });

    expect(result.hasErrors).toBe(true);
    expect(result.steps.find((step) => step.step === 'drain_side_effects')).toMatchObject({
      ok: false,
      error: 'SIDE_EFFECTS_FAILED',
      detail: { attempted: 3, processed: 2, failed: 1 },
    });
    expect(markExhaustedMock).toHaveBeenCalledOnce();
    expect(archiveMock).toHaveBeenCalledOnce();
  });

  it('classifica health-check parcial e sanitiza seus erros detalhados', async () => {
    healthMock.mockResolvedValue({
      checkedAccounts: 2,
      interruptedFound: 1,
      recoveredSuccessfully: 0,
      recoveryFailed: 1,
      errors: [{ contaId: 'private-tenant', webhookId: 'private-webhook', error: 'provider secret detail' }],
      executedAt: new Date(),
    });

    const result = await runWebhookScheduler({ skipQueueDrain: true, skipArchive: true });
    const healthStep = result.steps.find((step) => step.step === 'health_check');

    expect(result.hasErrors).toBe(true);
    expect(healthStep).toMatchObject({
      ok: false,
      error: 'HEALTH_CHECK_ERRORS',
      detail: {
        checkedAccounts: 2,
        interruptedFound: 1,
        recoveredSuccessfully: 0,
        recoveryFailed: 1,
        errors: 1,
      },
    });
    expect(JSON.stringify(healthStep)).not.toMatch(/private-tenant|private-webhook|provider secret detail/);
    expect(result.steps.find((step) => step.step === 'drift_check')?.ok).toBe(true);
  });

  it('classifica erros retornados pela reconciliação Asaas e mantém métricas pós-etapa', async () => {
    reconcileMock.mockResolvedValue({
      contaId: 'private-tenant',
      correlationId: 'private-correlation',
      asaasCalls: 3,
      checkedPayments: 2,
      reconciledPayments: 1,
      paymentDrift: 1,
      checkedSubscriptions: 0,
      reconciledSubscriptions: 0,
      subscriptionDrift: 0,
      checkedInstallments: 0,
      installmentDrift: 0,
      storeSalesFulfilled: 0,
      errors: ['provider secret detail'],
    });

    const result = await runWebhookScheduler({
      contaId: 'conta-a',
      enableReconciliation: true,
      skipQueueDrain: true,
      skipHealthCheck: true,
      skipDriftCheck: true,
      skipArchive: true,
    });
    const reconcileStep = result.steps.find((step) => step.step === 'reconcile_asaas');

    expect(result.hasErrors).toBe(true);
    expect(reconcileStep).toMatchObject({
      ok: false,
      error: 'ASAAS_RECONCILIATION_ERRORS',
      detail: {
        asaasCalls: 3,
        checkedPayments: 2,
        reconciledPayments: 1,
        paymentDrift: 1,
        errors: 1,
      },
    });
    expect(JSON.stringify(reconcileStep)).not.toMatch(/private-tenant|private-correlation|provider secret detail/);
    expect(queueMetricsMock).toHaveBeenCalledOnce();
  });

  it('não executa callback nem consulta Prisma quando o lock já está ocupado', async () => {
    lockMock.mockResolvedValue({
      acquired: false,
      jobName: 'webhook-scheduler:global',
      workerId: 'another-worker',
    });

    const result = await runWebhookScheduler();

    expect(result.skippedDueToLock).toBe(true);
    expect(lockMock.mock.calls[0]?.[1]).toBeTypeOf('function');
    expect(prismaMock.asaasAccount.findMany).not.toHaveBeenCalled();
    expect(recoveryMock).not.toHaveBeenCalled();
  });
});
