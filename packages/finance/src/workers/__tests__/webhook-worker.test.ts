import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../webhooks/asaas-webhook-handler.server', () => ({
  processAsaasWebhookQueue: vi.fn(async () => ({ processed: 0, failed: 0 })),
}));

vi.mock('../../webhooks/webhook-scheduler.service', () => ({
  runWebhookScheduler: vi.fn(async () => ({})),
}));

import { stopWorker, type WorkerCycleResult } from '../webhook-worker';

describe('webhook-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WEBHOOK_WORKER_INTERVAL_MS;
    delete process.env.WEBHOOK_WORKER_DRAIN_LIMIT;
    delete process.env.WEBHOOK_WORKER_CONTA_ID;
    delete process.env.WEBHOOK_WORKER_MODE;
    delete process.env.WEBHOOK_WORKER_ENABLE_SCHEDULER;
    delete process.env.WEBHOOK_WORKER_SCHEDULER_CYCLES;
  });

  afterEach(() => {
    stopWorker();
    vi.useRealTimers();
  });

  it('deve exportar startWorker e stopWorker', async () => {
    const workerModule = await import('../webhook-worker');
    expect(typeof workerModule.startWorker).toBe('function');
    expect(typeof workerModule.stopWorker).toBe('function');
  });

  it('modo once deve executar um ciclo e parar', async () => {
    process.env.WEBHOOK_WORKER_MODE = 'once';

    const { processAsaasWebhookQueue } = await import('../../webhooks/asaas-webhook-handler.server');
    vi.mocked(processAsaasWebhookQueue).mockResolvedValueOnce({ processed: 5, failed: 1 } as never);

    const spyLog = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { startWorker } = await import('../webhook-worker');
    await startWorker();

    expect(processAsaasWebhookQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        statuses: ['PENDENTE', 'ERRO'],
        source: 'REPROCESS',
      }),
    );

    spyLog.mockRestore();
  });

  it('deve usar config de env quando disponível', async () => {
    process.env.WEBHOOK_WORKER_MODE = 'once';
    process.env.WEBHOOK_WORKER_DRAIN_LIMIT = '10';
    process.env.WEBHOOK_WORKER_CONTA_ID = 'conta-test';

    const { processAsaasWebhookQueue } = await import('../../webhooks/asaas-webhook-handler.server');
    vi.mocked(processAsaasWebhookQueue).mockResolvedValueOnce({ processed: 0, failed: 0 } as never);

    const spyLog = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { startWorker } = await import('../webhook-worker');
    await startWorker();

    expect(processAsaasWebhookQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-test',
        limit: 10,
      }),
    );

    spyLog.mockRestore();
  });

  it('deve tratar erro no drain sem quebrar', async () => {
    process.env.WEBHOOK_WORKER_MODE = 'once';

    const { processAsaasWebhookQueue } = await import('../../webhooks/asaas-webhook-handler.server');
    vi.mocked(processAsaasWebhookQueue).mockRejectedValueOnce(new Error('DB offline'));

    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spyLog = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { startWorker } = await import('../webhook-worker');
    await startWorker();

    expect(spyError).toHaveBeenCalledWith(
      '[webhook-worker] Erro no ciclo de drain',
      expect.objectContaining({ error: 'DB offline' }),
    );

    spyError.mockRestore();
    spyLog.mockRestore();
  });
});
