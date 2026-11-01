import type { Prisma } from '@prisma/client';

export async function persistContractWhatsAppResendOperation(tx: Prisma.TransactionClient, input: {
  contaId: string;
  notificationId: string;
  operationId: string;
  actorUserId?: string | null;
  recipientPhone: string;
}) {
  const existing = await tx.contractWhatsAppResendOperation.findUnique({
    where: { uq_contract_whatsapp_resend_operation: { contaId: input.contaId, notificationId: input.notificationId, operationId: input.operationId } },
    select: { id: true },
  });
  if (existing) return false;

  await tx.contractWhatsAppResendOperation.create({ data: { contaId: input.contaId, notificationId: input.notificationId, operationId: input.operationId } });
  const updated = await tx.contractWhatsAppNotification.updateMany({
    where: { id: input.notificationId, contaId: input.contaId },
    data: {
      status: 'PENDING', recipientPhone: input.recipientPhone, nextAttemptAt: new Date(),
      lockedAt: null, lockedBy: null, processedAt: null, lastErrorCode: null, lastError: null,
      consentimentoRevogadoEm: null, lastManualOperationId: input.operationId,
    },
  });
  if (updated.count !== 1) throw new Error('CONTRACT_WHATSAPP_NOTIFICATION_CHANGED');
  await tx.auditLog.create({
    data: {
      contaId: input.contaId,
      actorType: input.actorUserId ? 'USER' : 'SYSTEM',
      actorId: input.actorUserId ?? null,
      action: 'contract.whatsapp.notification.requeued',
      entityType: 'ContractWhatsAppNotification',
      entityId: input.notificationId,
      correlationId: input.operationId,
    },
  });
  return true;
}
