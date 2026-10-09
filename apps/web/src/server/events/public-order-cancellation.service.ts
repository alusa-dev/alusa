import { deletePayment, handlePaymentWebhook } from '@alusa/finance';

import { runWithTenant } from '@/lib/prisma-tenant';

export type CancelPublicOrderResult = 'CANCELLED' | 'NOT_FOUND' | 'NOT_CANCELLABLE' | 'PROCESSING';

export async function cancelPendingPublicOrder(input: {
  orderId: string;
  contaId: string;
}): Promise<CancelPublicOrderResult> {
  const order = await runWithTenant(input.contaId, (tx) => tx.eventMapOrder.findFirst({
    where: { id: input.orderId, contaId: input.contaId },
    select: { id: true, status: true, paymentStatus: true, asaasPaymentId: true },
  }));
  if (!order) return 'NOT_FOUND';
  if (order.status !== 'PAYMENT_PENDING' || !['PENDING', 'OVERDUE'].includes(order.paymentStatus ?? '') || !order.asaasPaymentId) {
    return 'NOT_CANCELLABLE';
  }

  const deletion = await deletePayment(order.asaasPaymentId, { contaId: input.contaId });
  if (deletion.deleted !== true) return 'NOT_CANCELLABLE';

  const webhookResult = await handlePaymentWebhook(input.contaId, {
    event: 'PAYMENT_DELETED',
    payment: {
      id: deletion.id,
      status: 'DELETED',
      value: Number(deletion.value ?? 0),
      netValue: Number(deletion.netValue ?? deletion.value ?? 0),
      originalValue: deletion.originalValue ?? null,
      externalReference: deletion.externalReference ?? undefined,
      subscription: deletion.subscription ?? null,
      installment: deletion.installment ?? null,
      installmentNumber: null,
      dueDate: deletion.dueDate ?? null,
      paymentDate: deletion.paymentDate ?? null,
      clientPaymentDate: deletion.clientPaymentDate ?? null,
      creditDate: deletion.creditDate ?? null,
      estimatedCreditDate: deletion.estimatedCreditDate ?? null,
      billingType: deletion.billingType ?? null,
      deleted: true,
    },
  });
  if (!webhookResult.success) return 'PROCESSING';

  const cancelled = await runWithTenant(input.contaId, (tx) => tx.eventMapOrder.findFirst({
    where: { id: input.orderId, contaId: input.contaId },
    select: { status: true },
  }));
  return cancelled?.status === 'CANCELLED' ? 'CANCELLED' : 'PROCESSING';
}
