import {
  deletePayment,
  getPayment,
  handlePaymentWebhook,
} from '@alusa/finance';

export type DeletedPayment = Awaited<ReturnType<typeof deletePayment>>;
export type PaymentSnapshot = Awaited<ReturnType<typeof getPayment>>;

export function buildDeletedPaymentWebhookPayload(
  payment: DeletedPayment,
  fallbackExternalReference?: string,
) {
  return {
    event: 'PAYMENT_DELETED',
    payment: {
      id: payment.id,
      status: 'DELETED',
      value: Number(payment.value ?? 0),
      netValue: Number(payment.netValue ?? payment.value ?? 0),
      originalValue: payment.originalValue ?? null,
      externalReference: payment.externalReference ?? fallbackExternalReference ?? undefined,
      subscription: payment.subscription ?? null,
      installment: payment.installment ?? null,
      installmentNumber: null,
      dueDate: payment.dueDate ?? null,
      paymentDate: payment.paymentDate ?? null,
      clientPaymentDate: payment.clientPaymentDate ?? null,
      creditDate: payment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? null,
      billingType: payment.billingType ?? null,
      deleted: payment.deleted ?? true,
    },
  } as const;
}

export async function applyImmediateDeletedPaymentConvergence(
  contaId: string,
  payment: PaymentSnapshot,
  fallbackExternalReference?: string,
): Promise<boolean> {
  const webhookResult = await handlePaymentWebhook(
    contaId,
    buildDeletedPaymentWebhookPayload(
      payment as DeletedPayment,
      fallbackExternalReference,
    ),
  );
  return webhookResult.success;
}
