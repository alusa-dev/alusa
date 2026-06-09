import { listSubscriptionPayments, updatePayment } from '@alusa/finance';

type PaymentTerms = {
  interest?: { value: number } | null;
  fine?: { value: number; type?: 'FIXED' | 'PERCENTAGE' } | null;
  discount?: { value: number; type?: 'FIXED' | 'PERCENTAGE'; dueDateLimitDays?: number } | null;
};

type SyncablePayment = {
  id: string;
  value?: number | null;
  dueDate?: string | null;
  billingType?: string | null;
  deleted?: boolean | null;
};

const EDITABLE_ASAAS_PAYMENT_STATUSES = ['PENDING', 'OVERDUE'] as const;

function isSupportedBillingType(value?: string | null): value is 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED' {
  return value === 'BOLETO' || value === 'PIX' || value === 'CREDIT_CARD' || value === 'UNDEFINED';
}

function buildPaymentTermsPayload(terms: PaymentTerms) {
  return {
    ...(terms.interest ? { interest: { value: terms.interest.value } } : {}),
    ...(terms.fine ? { fine: { value: terms.fine.value, type: terms.fine.type ?? 'PERCENTAGE' } } : {}),
    ...(terms.discount
      ? {
          discount: {
            value: terms.discount.value,
            type: terms.discount.type ?? 'PERCENTAGE',
            dueDateLimitDays: terms.discount.dueDateLimitDays ?? 0,
          },
        }
      : {}),
  };
}

export async function syncEditableSubscriptionPayments(input: {
  contaId: string;
  asaasSubscriptionId: string;
  terms: PaymentTerms;
}) {
  const payments: SyncablePayment[] = [];

  for (const status of EDITABLE_ASAAS_PAYMENT_STATUSES) {
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const page = await listSubscriptionPayments(input.asaasSubscriptionId, {
        contaId: input.contaId,
        status,
        limit,
        offset,
      });

      payments.push(...(page.data as SyncablePayment[]).filter((payment) => !payment.deleted));
      hasMore = Boolean(page.hasMore);
      offset += limit;
    }
  }

  const termsPayload = buildPaymentTermsPayload(input.terms);
  const failures: Array<{ paymentId: string; message: string }> = [];
  let updated = 0;
  let skipped = 0;

  for (const payment of payments) {
    if (
      !payment.id ||
      typeof payment.value !== 'number' ||
      !payment.dueDate ||
      !isSupportedBillingType(payment.billingType)
    ) {
      skipped += 1;
      continue;
    }

    try {
      await updatePayment(
        payment.id,
        {
          billingType: payment.billingType,
          value: payment.value,
          dueDate: payment.dueDate,
          ...termsPayload,
        },
        { contaId: input.contaId },
      );
      updated += 1;
    } catch (error) {
      failures.push({
        paymentId: payment.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scanned: payments.length,
    updated,
    skipped,
    failed: failures.length,
    failures,
  };
}
