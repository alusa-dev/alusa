import { prisma } from '@/src/prisma';
import { MatriculaBillingOutboxStatus, MatriculaBillingProvisionStatus, Prisma } from '@prisma/client';
import { reconcileAcademicChargesWithAsaas } from '@alusa/finance';
import { enqueueEnrollmentBillingOutbox, resumeReconciledEnrollmentTerminalIntent } from './enrollment-billing-outbox.service';
import { billingProvisionUpdate } from './billing-provision-status';

export function toOperationalStatus(input: { billingProvisionStatus: MatriculaBillingProvisionStatus; outboxStatus?: MatriculaBillingOutboxStatus | null }) {
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO || input.outboxStatus === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION) return 'RECONCILIACAO_NECESSARIA';
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.FALHO || input.outboxStatus === MatriculaBillingOutboxStatus.FAILED) return 'INTERVENCAO_NECESSARIA';
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.PENDENTE || input.billingProvisionStatus === MatriculaBillingProvisionStatus.PROCESSANDO || input.outboxStatus === MatriculaBillingOutboxStatus.PENDING || input.outboxStatus === MatriculaBillingOutboxStatus.PROCESSING) return 'SINCRONIZANDO_FINANCEIRO';
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.PROVISIONADO) return 'FINANCEIRO_PREPARADO';
  return 'NAO_APLICAVEL';
}

export async function loadMatriculaProvisioningView(matriculaId: string, contaId: string) {
  const matricula = await prisma.matricula.findFirst({ where: { id: matriculaId, contaId }, select: { id: true, status: true, billingProvisionStatus: true, billingProvisionError: true, updatedAt: true } });
  if (!matricula) return null;
  const latestOutbox = await prisma.matriculaBillingOutbox.findFirst({ where: { contaId, matriculaId }, orderBy: [{ createdAt: 'desc' }], select: { id: true, status: true, terminalIntent: true, attempts: true, availableAt: true, processedAt: true, lastAttemptAt: true, lastError: true, updatedAt: true } });
  return {
    matriculaId: matricula.id,
    status: toOperationalStatus({ billingProvisionStatus: matricula.billingProvisionStatus, outboxStatus: latestOutbox?.status ?? null }),
    billingProvisionStatus: matricula.billingProvisionStatus,
    message: matricula.status === 'RECUSADA' || matricula.status === 'CANCELADA' ? 'Matrícula recusada ou cancelada. O provisionamento financeiro não pode ser reenviado.' : latestOutbox?.terminalIntent ? `Pedido de ${latestOutbox.terminalIntent.toLowerCase()} aguardando reconciliação financeira.` : matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO ? 'Financeiro com resultado incerto. Reconcilie antes de reenviar.' : latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED ? 'Financeiro com erro. Reenvio operacional disponível.' : latestOutbox?.status === MatriculaBillingOutboxStatus.PENDING ? 'Financeiro sincronizando automaticamente.' : 'Estado financeiro local atualizado.',
    canRetry: latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED && !latestOutbox.terminalIntent && matricula.status !== 'RECUSADA' && matricula.status !== 'CANCELADA',
    requiresReconciliation: matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO || latestOutbox?.status === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION || Boolean(latestOutbox?.terminalIntent),
    lastError: latestOutbox?.lastError ?? matricula.billingProvisionError ?? null,
    updatedAt: (latestOutbox?.updatedAt ?? matricula.updatedAt).toISOString(),
  };
}

export async function reconcileMatriculaProvisioning(input: { matriculaId: string; contaId: string; actorUserId: string }) {
  const charges = await prisma.cobranca.findMany({ where: { contaId: input.contaId, matriculaId: input.matriculaId, asaasPaymentId: { not: null } }, select: { id: true } });
  const terminalOutbox = await prisma.matriculaBillingOutbox.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
      terminalIntent: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, terminalIntent: true },
  });
  if (charges.length === 0) {
    if (terminalOutbox) {
      await prisma.matriculaLog.create({
        data: {
          matriculaId: input.matriculaId,
          actorId: input.actorUserId,
          action: 'MATRICULA_INTENCAO_TERMINAL_RECONCILIACAO_SEM_COBRANCAS',
          metadata: { eventId: terminalOutbox.id, intent: terminalOutbox.terminalIntent } as Prisma.InputJsonValue,
        },
      });
      return { ok: false as const, code: 'INTENCAO_TERMINAL_SEM_COBRANCAS_REQUER_REVISAO' };
    }
    return { ok: false as const, code: 'RECONCILIACAO_MANUAL_NECESSARIA' };
  }
  const result = await reconcileAcademicChargesWithAsaas({ contaId: input.contaId, cobrancaIds: charges.map((charge) => charge.id), force: true });
  await prisma.matriculaLog.create({ data: { matriculaId: input.matriculaId, actorId: input.actorUserId, action: 'BILLING_PROVISION_RECONCILIATION_CHECKED', metadata: { checked: result.checked, updated: result.updated, cobrancaIds: charges.map((charge) => charge.id) } } });

  if (terminalOutbox?.terminalIntent) {
    const missingSnapshots = charges.filter((charge) => !result.items.has(charge.id));
    if (missingSnapshots.length > 0) {
      await prisma.matriculaLog.create({
        data: {
          matriculaId: input.matriculaId,
          actorId: input.actorUserId,
          action: 'MATRICULA_INTENCAO_TERMINAL_RECONCILIACAO_INCOMPLETA',
          metadata: { eventId: terminalOutbox.id, missingChargeIds: missingSnapshots.map((charge) => charge.id) } as Prisma.InputJsonValue,
        },
      });
    }

    // Even when a payment is paid or its reconciliation snapshot is missing,
    // run the safe terminal finalizer after the remote reconciliation attempt.
    // It re-reads each open payment before deleting it, stops recurrence, and
    // leaves the academic status pending if any payment remains paid/unknown.
    // It never refunds or deletes paid receipts.
    const resumed = await resumeReconciledEnrollmentTerminalIntent({
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      actorUserId: input.actorUserId,
    });
    if (resumed.status !== 'CANCELLED') {
      const reason = resumed.error ?? 'O estado remoto ainda não permite concluir a recusa/cancelamento.';
      const paidRequiresDecision = reason.includes('COBRANCA_PAGA');
      await prisma.matricula.updateMany({
        where: { id: input.matriculaId, contaId: input.contaId, status: { notIn: ['RECUSADA', 'CANCELADA'] } },
        data: billingProvisionUpdate(MatriculaBillingProvisionStatus.RESULTADO_INCERTO, reason),
      });
      await prisma.matriculaLog.create({
        data: {
          matriculaId: input.matriculaId,
          actorId: input.actorUserId,
          action: 'MATRICULA_INTENCAO_TERMINAL_BLOQUEADA_POR_ESTADO_FINANCEIRO',
          metadata: { eventId: terminalOutbox.id, intent: terminalOutbox.terminalIntent, reason } as Prisma.InputJsonValue,
        },
      });
      return {
        ok: false as const,
        code: paidRequiresDecision
          ? 'COBRANCA_PAGA_REQUER_DECISAO_MANUAL'
          : 'INTENCAO_TERMINAL_ESTADO_REMOTO_INCOMPLETO',
        reason,
        checked: result.checked,
        updated: result.updated,
      };
    }
    return {
      ok: true as const,
      checked: result.checked,
      updated: result.updated,
      terminalIntent: { completed: true as const, intent: terminalOutbox.terminalIntent },
    };
  }

  return { ok: true as const, checked: result.checked, updated: result.updated };
}

export type MatriculaProvisioningRetryResult =
  | 'QUEUED'
  | 'TERMINAL'
  | 'RECONCILIATION_REQUIRED'
  | 'NOT_RETRYABLE';

export async function retryMatriculaProvisioning(input: { matriculaId: string; contaId: string; actorUserId: string }): Promise<MatriculaProvisioningRetryResult> {
  const enrollment = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    select: { status: true },
  });
  if (!enrollment || enrollment.status === 'RECUSADA' || enrollment.status === 'CANCELADA') return 'TERMINAL';

  const latestOutbox = await prisma.matriculaBillingOutbox.findFirst({ where: { contaId: input.contaId, matriculaId: input.matriculaId }, orderBy: [{ createdAt: 'desc' }], select: { id: true, status: true, terminalIntent: true } });
  if (latestOutbox?.status === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION || latestOutbox?.terminalIntent) return 'RECONCILIATION_REQUIRED';
  if (latestOutbox?.status === MatriculaBillingOutboxStatus.CANCELLED) return 'TERMINAL';
  if (latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED) {
    const reopened = await prisma.$transaction(async (tx) => {
      const outboxUpdate = await tx.matriculaBillingOutbox.updateMany({
        where: {
          id: latestOutbox.id,
          contaId: input.contaId,
          status: MatriculaBillingOutboxStatus.FAILED,
          terminalIntent: null,
          claimToken: null,
          matricula: { is: { status: { notIn: ['RECUSADA', 'CANCELADA'] } } },
        },
        data: { status: MatriculaBillingOutboxStatus.PENDING, availableAt: new Date(), lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: null },
      });
      if (outboxUpdate.count === 0) return false;
      await tx.matricula.updateMany({
        where: { id: input.matriculaId, contaId: input.contaId, status: { notIn: ['RECUSADA', 'CANCELADA'] } },
        data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PENDENTE),
      });
      return true;
    });
    return reopened ? 'QUEUED' : 'TERMINAL';
  } else {
    const enqueued = await enqueueEnrollmentBillingOutbox({ contaId: input.contaId, matriculaId: input.matriculaId, actorUserId: input.actorUserId });
    if (!enqueued) return 'TERMINAL';
    if (enqueued.status === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION) return 'RECONCILIATION_REQUIRED';
    if (enqueued.status === MatriculaBillingOutboxStatus.CANCELLED) return 'TERMINAL';
    return enqueued.status === MatriculaBillingOutboxStatus.PENDING || enqueued.status === MatriculaBillingOutboxStatus.PROCESSING
      ? 'QUEUED'
      : 'NOT_RETRYABLE';
  }
}
