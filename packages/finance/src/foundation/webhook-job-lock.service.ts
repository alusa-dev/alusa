import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

export type WebhookJobLockAcquireResult =
  | { acquired: true; jobName: string; workerId: string; lockedUntil: Date }
  | { acquired: false; jobName: string; lockedUntil: Date | null; workerId: string | null };

export interface WebhookJobLockOptions {
  ttlMs?: number;
  workerId?: string;
  metadata?: Prisma.InputJsonValue;
}

const DEFAULT_JOB_LOCK_TTL_MS = 4 * 60 * 1000;

function resolveTtlMs(ttlMs?: number): number {
  if (!Number.isFinite(ttlMs) || !ttlMs || ttlMs <= 0) return DEFAULT_JOB_LOCK_TTL_MS;
  return Math.min(Math.max(Math.floor(ttlMs), 10_000), 30 * 60_000);
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

export async function acquireWebhookJobLock(
  jobName: string,
  options: WebhookJobLockOptions = {},
): Promise<WebhookJobLockAcquireResult> {
  const normalizedJobName = jobName.trim();
  if (!normalizedJobName) {
    throw new Error('jobName é obrigatório para lock de webhook.');
  }

  const now = new Date();
  const ttlMs = resolveTtlMs(options.ttlMs);
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const workerId = options.workerId ?? `worker:${process.pid}:${randomUUID()}`;

  try {
    await prisma.webhookJobLock.create({
      data: {
        jobName: normalizedJobName,
        workerId,
        lockedAt: now,
        lockedUntil,
        lastHeartbeatAt: now,
        metadata: options.metadata ?? undefined,
      },
      select: { jobName: true },
    });

    return { acquired: true, jobName: normalizedJobName, workerId, lockedUntil };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const updated = await prisma.webhookJobLock.updateMany({
    where: {
      jobName: normalizedJobName,
      lockedUntil: { lt: now },
    },
    data: {
      workerId,
      lockedAt: now,
      lockedUntil,
      lastHeartbeatAt: now,
      metadata: options.metadata ?? undefined,
    },
  });

  if (updated.count === 1) {
    return { acquired: true, jobName: normalizedJobName, workerId, lockedUntil };
  }

  const current = await prisma.webhookJobLock.findUnique({
    where: { jobName: normalizedJobName },
    select: { lockedUntil: true, workerId: true },
  });

  return {
    acquired: false,
    jobName: normalizedJobName,
    lockedUntil: current?.lockedUntil ?? null,
    workerId: current?.workerId ?? null,
  };
}

export async function releaseWebhookJobLock(params: {
  jobName: string;
  workerId: string;
}): Promise<void> {
  const now = new Date();
  await prisma.webhookJobLock.updateMany({
    where: {
      jobName: params.jobName,
      workerId: params.workerId,
    },
    data: {
      lockedUntil: now,
      lastHeartbeatAt: now,
    },
  });
}

export async function withWebhookJobLock<T>(
  jobName: string,
  fn: () => Promise<T>,
  options: WebhookJobLockOptions = {},
): Promise<
  | { acquired: true; result: T; jobName: string; workerId: string }
  | { acquired: false; jobName: string; lockedUntil: Date | null; workerId: string | null }
> {
  const lock = await acquireWebhookJobLock(jobName, options);
  if (!lock.acquired) {
    return lock;
  }

  try {
    const result = await fn();
    return {
      acquired: true,
      result,
      jobName: lock.jobName,
      workerId: lock.workerId,
    };
  } finally {
    await releaseWebhookJobLock({
      jobName: lock.jobName,
      workerId: lock.workerId,
    }).catch((error: unknown) => {
      console.warn('[webhook-job-lock] Falha ao liberar lock', {
        jobName: lock.jobName,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
