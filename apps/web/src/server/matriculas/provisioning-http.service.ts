import { prisma } from '@/src/prisma';
import { MatriculaBillingOutboxStatus, MatriculaBillingProvisionStatus } from '@prisma/client';
import { reconcileAcademicChargesWithAsaas } from '@alusa/finance';
import { enqueueEnrollmentBillingOutbox } from './enrollment-billing-outbox.service';
import { billingProvisionUpdate } from './billing-provision-status';

export function toOperationalStatus(input: { billingProvisionStatus: MatriculaBillingProvisionStatus; outboxStatus?: MatriculaBillingOutboxStatus | null }) {
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO || input.outboxStatus === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION) return 'RECONCILIACAO_NECESSARIA';
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.FALHO || input.outboxStatus === MatriculaBillingOutboxStatus.FAILED) return 'INTERVENCAO_NECESSARIA';
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.PENDENTE || input.billingProvisionStatus === MatriculaBillingProvisionStatus.PROCESSANDO || input.outboxStatus === MatriculaBillingOutboxStatus.PENDING || input.outboxStatus === MatriculaBillingOutboxStatus.PROCESSING) return 'SINCRONIZANDO_FINANCEIRO';
  if (input.billingProvisionStatus === MatriculaBillingProvisionStatus.PROVISIONADO) return 'FINANCEIRO_PREPARADO';
  return 'NAO_APLICAVEL';
}

export async function loadMatriculaProvisioningView(matriculaId: string, contaId: string) {
  const matricula = await prisma.matricula.findFirst({ where: { id: matriculaId, contaId }, select: { id: true, billingProvisionStatus: true, billingProvisionError: true, updatedAt: true } });
  if (!matricula) return null;
  const latestOutbox = await prisma.matriculaBillingOutbox.findFirst({ where: { contaId, matriculaId }, orderBy: [{ createdAt: 'desc' }], select: { id: true, status: true, attempts: true, availableAt: true, processedAt: true, lastAttemptAt: true, lastError: true, updatedAt: true } });
  return {
    matriculaId: matricula.id,
    status: toOperationalStatus({ billingProvisionStatus: matricula.billingProvisionStatus, outboxStatus: latestOutbox?.status ?? null }),
    billingProvisionStatus: matricula.billingProvisionStatus,
    message: matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO ? 'Financeiro com resultado incerto. Reconcilie antes de reenviar.' : latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED ? 'Financeiro com erro. Reenvio operacional disponível.' : latestOutbox?.status === MatriculaBillingOutboxStatus.PENDING ? 'Financeiro sincronizando automaticamente.' : 'Estado financeiro local atualizado.',
    canRetry: latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED,
    requiresReconciliation: matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO || latestOutbox?.status === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
    lastError: latestOutbox?.lastError ?? matricula.billingProvisionError ?? null,
    updatedAt: (latestOutbox?.updatedAt ?? matricula.updatedAt).toISOString(),
  };
}

export async function reconcileMatriculaProvisioning(input: { matriculaId: string; contaId: string; actorUserId: string }) {
  const charges = await prisma.cobranca.findMany({ where: { contaId: input.contaId, matriculaId: input.matriculaId, asaasPaymentId: { not: null } }, select: { id: true } });
  if (charges.length === 0) return { ok: false as const, code: 'RECONCILIACAO_MANUAL_NECESSARIA' };
  const result = await reconcileAcademicChargesWithAsaas({ contaId: input.contaId, cobrancaIds: charges.map((charge) => charge.id), force: true });
  await prisma.matriculaLog.create({ data: { matriculaId: input.matriculaId, actorId: input.actorUserId, action: 'BILLING_PROVISION_RECONCILIATION_CHECKED', metadata: { checked: result.checked, updated: result.updated, cobrancaIds: charges.map((charge) => charge.id) } } });
  return { ok: true as const, checked: result.checked, updated: result.updated };
}

export async function retryMatriculaProvisioning(input: { matriculaId: string; contaId: string; actorUserId: string }) {
  const latestOutbox = await prisma.matriculaBillingOutbox.findFirst({ where: { contaId: input.contaId, matriculaId: input.matriculaId }, orderBy: [{ createdAt: 'desc' }], select: { id: true, status: true } });
  if (latestOutbox?.status === MatriculaBillingOutboxStatus.FAILED) {
    await prisma.$transaction(async (tx) => {
      await tx.matriculaBillingOutbox.update({ where: { id: latestOutbox.id }, data: { status: MatriculaBillingOutboxStatus.PENDING, availableAt: new Date(), lockedAt: null, leaseExpiresAt: null, lastError: null } });
      await tx.matricula.updateMany({ where: { id: input.matriculaId, contaId: input.contaId }, data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PENDENTE) });
    });
  } else {
    await enqueueEnrollmentBillingOutbox({ contaId: input.contaId, matriculaId: input.matriculaId, actorUserId: input.actorUserId });
  }
}
