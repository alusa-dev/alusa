import { randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

export type WebhookJobLockAcquireResult =
  | { acquired: true; jobName: string; workerId: string; lockedUntil: Date }
  | { acquired: false; jobName: string; lockedUntil: Date | null; workerId: string | null };

export interface WebhookJobLockOptions {
  ttlMs?: number;
  workerId?: string;
  metadata?: PrismaTypes.InputJsonValue;
}

const DEFAULT_JOB_LOCK_TTL_MS = 4 * 60 * 1000;

function resolveTtlMs(ttlMs?: number): number {
  if (!Number.isFinite(ttlMs) || !ttlMs || ttlMs <= 0) return DEFAULT_JOB_LOCK_TTL_MS;
  return Math.min(Math.max(Math.floor(ttlMs), 10_000), 30 * 60_000);
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

  const metadata = options.metadata === undefined ? null : JSON.stringify(options.metadata);
  const claimed = await prisma.$queryRaw<Array<{ jobName: string }>>(
    Prisma.sql`
      INSERT INTO "WebhookJobLock" (
        "jobName",
        "lockedAt",
        "lockedUntil",
        "workerId",
        "lastHeartbeatAt",
        "metadata",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${normalizedJobName},
        ${now},
        ${lockedUntil},
        ${workerId},
        ${now},
        ${metadata}::jsonb,
        ${now},
        ${now}
      )
      ON CONFLICT ("jobName") DO UPDATE
      SET
        "lockedAt" = EXCLUDED."lockedAt",
        "lockedUntil" = EXCLUDED."lockedUntil",
        "workerId" = EXCLUDED."workerId",
        "lastHeartbeatAt" = EXCLUDED."lastHeartbeatAt",
        "metadata" = EXCLUDED."metadata",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE "WebhookJobLock"."lockedUntil" < EXCLUDED."lockedAt"
      RETURNING "jobName"
    `,
  );

  if (claimed.length === 1) {
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

export async function renewWebhookJobLock(params: {
  jobName: string;
  workerId: string;
  ttlMs?: number;
}): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + resolveTtlMs(params.ttlMs));
  const renewed = await prisma.webhookJobLock.updateMany({
    where: {
      jobName: params.jobName,
      workerId: params.workerId,
      lockedUntil: { gt: now },
    },
    data: {
      lockedUntil,
      lastHeartbeatAt: now,
    },
  });

  return renewed.count === 1;
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

  const heartbeatEveryMs = Math.min(
    Math.max(Math.floor(resolveTtlMs(options.ttlMs) / 3), 5_000),
    60_000,
  );
  const heartbeat = setInterval(() => {
    void renewWebhookJobLock({
      jobName: lock.jobName,
      workerId: lock.workerId,
      ttlMs: options.ttlMs,
    }).then((renewed) => {
      if (!renewed) {
        console.warn('[webhook-job-lock] Lease perdido durante heartbeat', {
          jobName: lock.jobName,
          workerId: lock.workerId,
        });
      }
    }).catch((error: unknown) => {
      console.warn('[webhook-job-lock] Falha no heartbeat', {
        jobName: lock.jobName,
        workerId: lock.workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, heartbeatEveryMs);
  heartbeat.unref?.();

  try {
    const result = await fn();
    return {
      acquired: true,
      result,
      jobName: lock.jobName,
      workerId: lock.workerId,
    };
  } finally {
    clearInterval(heartbeat);
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
