import {
  BillingMode,
  MatriculaBillingOutboxStatus,
  MatriculaBillingProvisionStatus,
} from '@prisma/client';
import { prisma } from '@/src/prisma';
import {
  enqueueEnrollmentBillingOutbox,
  enqueueEnrollmentSubscriptionMergeOutbox,
  processEnrollmentBillingOutboxEvent,
} from '@/src/server/matriculas/enrollment-billing-outbox.service';
import { billingProvisionUpdate } from '@/src/server/matriculas/billing-provision-status';

const DEFAULT_MIN_AGE_MINUTES = 5;
const DEFAULT_LIMIT = 25;

export type RetryEnrollmentBillingProvisionInput = {
  contaId?: string;
  minAgeMinutes?: number;
  limit?: number;
  dryRun?: boolean;
};

export type RetryEnrollmentBillingProvisionResult = {
  scanned: number;
  retried: number;
  recovered: number;
  skipped: number;
  errors: Array<{ matriculaId: string; error: string }>;
};

function readSubscriptionTargetId(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const direct = (metadata as Record<string, unknown>).subscriptionTargetId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const strategy = (metadata as Record<string, unknown>).billingStrategy;
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) return null;
  const financialGroupId = (strategy as Record<string, unknown>).financialGroupId;
  if (typeof financialGroupId !== 'string') return null;
  return financialGroupId.startsWith('subscription:')
    ? financialGroupId.slice('subscription:'.length).trim() || null
    : null;
}

function needsBillingRetry(status: MatriculaBillingProvisionStatus) {
  return (
    status === MatriculaBillingProvisionStatus.PENDENTE ||
    status === MatriculaBillingProvisionStatus.PARCIAL ||
    status === MatriculaBillingProvisionStatus.FALHO ||
    status === MatriculaBillingProvisionStatus.PROCESSANDO
  );
}

export async function retryEnrollmentBillingProvisionJob(
  input: RetryEnrollmentBillingProvisionInput = {},
): Promise<RetryEnrollmentBillingProvisionResult> {
  const minAgeMinutes = Math.max(1, input.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 100));
  const threshold = new Date(Date.now() - minAgeMinutes * 60 * 1000);

  const result: RetryEnrollmentBillingProvisionResult = {
    scanned: 0,
    retried: 0,
    recovered: 0,
    skipped: 0,
    errors: [],
  };

  const candidates = await prisma.matricula.findMany({
    where: {
      billingProvisionStatus: {
        in: [
          MatriculaBillingProvisionStatus.PENDENTE,
          MatriculaBillingProvisionStatus.PARCIAL,
          MatriculaBillingProvisionStatus.FALHO,
          MatriculaBillingProvisionStatus.PROCESSANDO,
        ],
      },
      createdAt: { lt: threshold },
      ...(input.contaId ? { contaId: input.contaId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  result.scanned = candidates.length;

  for (const matricula of candidates) {
    if (!needsBillingRetry(matricula.billingProvisionStatus)) {
      result.skipped += 1;
      continue;
    }

    const queued = await prisma.matriculaBillingOutbox.findFirst({
      where: {
        contaId: matricula.contaId,
        matriculaId: matricula.id,
        status: {
          in: [
            MatriculaBillingOutboxStatus.PENDING,
            MatriculaBillingOutboxStatus.PROCESSING,
            MatriculaBillingOutboxStatus.FAILED,
            MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          ],
        },
      },
      select: { id: true },
    });
    if (queued) {
      if (input.dryRun) {
        result.retried += 1;
        continue;
      }
      const processed = await processEnrollmentBillingOutboxEvent(queued.id);
      result.retried += 1;
      if (processed.status === 'PROCESSED') {
        result.recovered += 1;
      }
      continue;
    }

    if (input.dryRun) {
      result.retried += 1;
      continue;
    }

    try {
      let enqueued: { id: string } | null = null;
      if (matricula.billingMode === BillingMode.SHARED_PLAN) {
        const allocation = await prisma.familyFinancialAllocation.findFirst({
          where: {
            contaId: matricula.contaId,
            matriculaId: matricula.id,
            chargeKind: 'MENSALIDADE',
          },
          orderBy: { createdAt: 'asc' },
          select: { metadata: true },
        });
        const subscriptionTargetId = readSubscriptionTargetId(
          allocation?.metadata,
        );
        if (!subscriptionTargetId) {
          await prisma.matricula.update({
            where: { id: matricula.id },
            data: billingProvisionUpdate(
              MatriculaBillingProvisionStatus.FALHO,
              'COBRANCA_UNIFICADA_SEM_ASSINATURA_DESTINO',
            ),
          });
          result.errors.push({
            matriculaId: matricula.id,
            error: 'COBRANCA_UNIFICADA_SEM_ASSINATURA_DESTINO',
          });
          continue;
        }
        enqueued = await enqueueEnrollmentSubscriptionMergeOutbox({
          contaId: matricula.contaId,
          matriculaId: matricula.id,
          subscriptionTargetId,
          actorUserId: 'retry-enrollment-billing-job',
        });
      } else {
        enqueued = await enqueueEnrollmentBillingOutbox({
          contaId: matricula.contaId,
          matriculaId: matricula.id,
          actorUserId: 'retry-enrollment-billing-job',
        });
      }

      result.retried += 1;
      const processed = await processEnrollmentBillingOutboxEvent(enqueued.id);
      if (processed.status === 'PROCESSED') {
        result.recovered += 1;
      }
    } catch (error) {
      result.errors.push({
        matriculaId: matricula.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info('[retry-enrollment-billing]', result);
  return result;
}
