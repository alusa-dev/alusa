import { beforeEach, describe, expect, it, vi } from 'vitest';

const { webhookJobLockMock } = vi.hoisted(() => ({
  webhookJobLockMock: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    webhookJobLock: webhookJobLockMock,
  },
}));

import { acquireWebhookJobLock, withWebhookJobLock } from '../webhook-job-lock.service';

describe('webhookJobLockService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adquire lock criando registro novo', async () => {
    webhookJobLockMock.create.mockResolvedValue({ jobName: 'webhook-scheduler:global' });

    const result = await acquireWebhookJobLock('webhook-scheduler:global', {
      workerId: 'worker_1',
      ttlMs: 60_000,
    });

    expect(result).toMatchObject({
      acquired: true,
      jobName: 'webhook-scheduler:global',
      workerId: 'worker_1',
    });
    expect(webhookJobLockMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobName: 'webhook-scheduler:global',
          workerId: 'worker_1',
        }),
      }),
    );
  });

  it('adquire lock expirado sem concorrer com execução ativa', async () => {
    webhookJobLockMock.create.mockRejectedValue({ code: 'P2002' });
    webhookJobLockMock.updateMany.mockResolvedValue({ count: 1 });

    const result = await acquireWebhookJobLock('webhook-scheduler:global', {
      workerId: 'worker_2',
      ttlMs: 60_000,
    });

    expect(result.acquired).toBe(true);
    expect(webhookJobLockMock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobName: 'webhook-scheduler:global',
          lockedUntil: expect.objectContaining({ lt: expect.any(Date) }),
        }),
        data: expect.objectContaining({ workerId: 'worker_2' }),
      }),
    );
  });

  it('retorna busy quando lock ainda está válido', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    webhookJobLockMock.create.mockRejectedValue({ code: 'P2002' });
    webhookJobLockMock.updateMany.mockResolvedValue({ count: 0 });
    webhookJobLockMock.findUnique.mockResolvedValue({ lockedUntil, workerId: 'worker_active' });

    const result = await acquireWebhookJobLock('webhook-scheduler:global');

    expect(result).toEqual({
      acquired: false,
      jobName: 'webhook-scheduler:global',
      lockedUntil,
      workerId: 'worker_active',
    });
  });

  it('withWebhookJobLock executa função e libera lock no finally', async () => {
    webhookJobLockMock.create.mockResolvedValue({ jobName: 'webhook-scheduler:global' });
    webhookJobLockMock.updateMany.mockResolvedValue({ count: 1 });
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withWebhookJobLock('webhook-scheduler:global', fn, {
      workerId: 'worker_3',
    });

    expect(result).toMatchObject({ acquired: true, result: 'ok' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(webhookJobLockMock.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobName: 'webhook-scheduler:global', workerId: 'worker_3' },
        data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
      }),
    );
  });
});
