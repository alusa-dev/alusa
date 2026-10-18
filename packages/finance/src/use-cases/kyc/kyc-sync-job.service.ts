import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { refreshKycReadModel } from './refresh-kyc-read-model';
import { isCacheV2 } from './kyc-cache-utils';

const JOB_TYPE = 'SYNC_KYC_STATUS' as const;
const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;
const MAX_JOBS_PER_RUN = 10;

function retryDelayMs(attempt: number): number {
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

/** Enfileira somente o bootstrap do read model da subconta recém provisionada. */
export async function enqueueKycReadModelSync(contaId: string): Promise<void> {
  const account = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId }, asaasAccountId: { not: null } },
    select: { id: true, provisionedAt: true, documentsCache: true, documentsCacheUpdatedAt: true },
  });
  if (!account) return;

  const cache = account.documentsCache as unknown;
  if (
    isCacheV2(cache)
    && account.documentsCacheUpdatedAt
    && account.documentsCacheUpdatedAt.getTime() >= (account.provisionedAt?.getTime() ?? 0)
  ) return;

  await enqueueKycReadModelSyncForAccount(prisma, {
    contaId,
    asaasAccountId: account.id,
    provisionedAt: account.provisionedAt,
  });

  const generation = account.provisionedAt?.toISOString() ?? 'unprovisioned';
  const idempotencyKey = `kyc-bootstrap:${account.id}:${generation}`;
  const nextAttemptAt = new Date(Math.max(Date.now(), (account.provisionedAt?.getTime() ?? 0) + 15_000));
  await prisma.$transaction(async (tx) => {
    const replay = await tx.asaasIntegrationJob.updateMany({
      where: {
        contaId,
        type: JOB_TYPE,
        idempotencyKey,
        status: 'FAILED',
        attempts: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt,
        lastError: null,
        lastErrorAt: null,
        processingAt: null,
        doneAt: null,
      },
    });
    if (replay.count !== 1) return;

    await auditLogService.record({
      contaId,
      action: 'finance.kyc.bootstrap_job.requeued',
      entity: { type: 'AsaasIntegrationJob', id: `${account.id}:${generation}` },
      metadata: { generation, previousAttempts: MAX_ATTEMPTS },
      actor: { type: 'SYSTEM' },
    }, tx);
  });
}

export async function enqueueKycReadModelSyncForAccount(
  db: Pick<Prisma.TransactionClient, 'asaasIntegrationJob'>,
  params: { contaId: string; asaasAccountId: string; provisionedAt: Date | null },
): Promise<void> {
  const generation = params.provisionedAt?.toISOString() ?? 'unprovisioned';
  const idempotencyKey = `kyc-bootstrap:${params.asaasAccountId}:${generation}`;
  const nextAttemptAt = new Date(Math.max(Date.now() + 15_000, (params.provisionedAt?.getTime() ?? 0) + 15_000));
  await db.asaasIntegrationJob.upsert({
    where: {
      uq_asaas_integration_job: {
        contaId: params.contaId,
        type: JOB_TYPE,
        idempotencyKey,
      },
    },
    create: {
      contaId: params.contaId,
      type: JOB_TYPE,
      status: 'PENDING',
      idempotencyKey,
      nextAttemptAt,
      payload: { asaasAccountId: params.asaasAccountId },
    },
    // Keep an existing retry schedule and terminal result intact.
    update: {},
    select: { id: true },
  });
}

export type KycReadModelSyncJobResult = {
  scanned: number;
  processed: number;
  skippedFresh: number;
  failed: number;
  lostClaims: number;
  errors: Array<{ jobId: string; contaId: string; error: string }>;
};

/** Processes only queued KYC bootstrap jobs; each job is claimed atomically. */
export async function processKycReadModelSyncJobs(params?: {
  contaId?: string;
  limit?: number;
}): Promise<KycReadModelSyncJobResult> {
  const limit = Math.max(1, Math.min(params?.limit ?? MAX_JOBS_PER_RUN, MAX_JOBS_PER_RUN));
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const jobs = await prisma.asaasIntegrationJob.findMany({
    where: {
      type: JOB_TYPE,
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', processingAt: { lt: staleProcessingBefore } },
      ],
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  const result: KycReadModelSyncJobResult = {
    scanned: jobs.length,
    processed: 0,
    skippedFresh: 0,
    failed: 0,
    lostClaims: 0,
    errors: [],
  };

  for (const job of jobs) {
    const claimAt = new Date();
    const claimWhere = job.status === 'PROCESSING'
      ? {
          id: job.id,
          status: 'PROCESSING' as const,
          attempts: job.attempts,
          processingAt: job.processingAt,
        }
      : {
          id: job.id,
          status: job.status,
          attempts: job.attempts,
          nextAttemptAt: { lte: now },
        };
    const terminalStaleClaim = job.status === 'PROCESSING' && job.attempts >= MAX_ATTEMPTS;
    const claim = await prisma.asaasIntegrationJob.updateMany({
      where: claimWhere,
      data: terminalStaleClaim
        ? {
            status: 'FAILED',
            processingAt: null,
            lastError: 'Worker interrompido após atingir o limite de tentativas.',
            lastErrorAt: claimAt,
          }
        : {
            status: 'PROCESSING',
            processingAt: claimAt,
            attempts: { increment: 1 },
          },
    });
    if (claim.count !== 1) continue;

    if (terminalStaleClaim) {
      result.failed++;
      result.errors.push({ jobId: job.id, contaId: job.contaId, error: 'Limite de tentativas atingido após interrupção do worker.' });
      continue;
    }

    const attempts = job.attempts + 1;
    try {
      const account = await prisma.asaasAccount.findFirst({
        where: { id: job.payload && typeof job.payload === 'object' ? String((job.payload as { asaasAccountId?: unknown }).asaasAccountId ?? '') : '', financeProfile: { contaId: job.contaId } },
        select: { id: true, asaasAccountId: true, provisionedAt: true, documentsCache: true, documentsCacheUpdatedAt: true },
      });
      if (!account) throw new Error('Subconta KYC não encontrada para este tenant.');

      const currentGeneration = `kyc-bootstrap:${account.id}:${account.provisionedAt?.toISOString() ?? 'unprovisioned'}`;
      if (job.idempotencyKey !== currentGeneration) {
        const finalized = await prisma.asaasIntegrationJob.updateMany({
          where: { id: job.id, status: 'PROCESSING', processingAt: claimAt },
          data: { status: 'DONE', doneAt: new Date(), processingAt: null, lastError: null, lastErrorAt: null },
        });
        if (finalized.count === 1) result.skippedFresh++;
        else result.lostClaims++;
        continue;
      }

      const cached = account.documentsCache as unknown;
      const hasNewerReadModel = isCacheV2(cached)
        && account.documentsCacheUpdatedAt !== null
        && account.documentsCacheUpdatedAt.getTime() >= (account.provisionedAt?.getTime() ?? 0);
      if (!hasNewerReadModel) {
        const credentials = await loadAsaasCredentials(job.contaId);
        if (!credentials) throw new Error('Credenciais Asaas ausentes para sincronizar o KYC. Verifique a configuração BaaS da conta.');
        await refreshKycReadModel(job.contaId);
      }

      const finalized = await prisma.asaasIntegrationJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', processingAt: claimAt },
        data: { status: 'DONE', doneAt: new Date(), processingAt: null, lastError: null, lastErrorAt: null },
      });
      if (finalized.count === 1) {
        result.processed++;
        if (hasNewerReadModel) result.skippedFresh++;
      }
      else result.lostClaims++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attempts >= MAX_ATTEMPTS;
      const finalized = await prisma.asaasIntegrationJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', processingAt: claimAt },
        data: {
          status: 'FAILED',
          nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
          lastError: exhausted ? `${message} (limite de tentativas atingido)` : message,
          lastErrorAt: new Date(),
          processingAt: null,
        },
      });
      if (finalized.count === 1) {
        result.failed++;
        result.errors.push({ jobId: job.id, contaId: job.contaId, error: message });
      } else {
        result.lostClaims++;
      }
    }
  }

  return result;
}
