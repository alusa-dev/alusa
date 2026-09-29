import { getPayment, listSubscriptionPayments, updatePayment } from '@alusa/finance';

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

// Asaas documents updates for charges that have not been paid or confirmed.
// OVERDUE is intentionally included: the provider is the final authority and
// its response is confirmed below before any local projection is considered
// successful.
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
      const fresh = await getPayment(payment.id, { contaId: input.contaId });
      if (!EDITABLE_ASAAS_PAYMENT_STATUSES.includes(fresh.status as (typeof EDITABLE_ASAAS_PAYMENT_STATUSES)[number])) {
        failures.push({
          paymentId: payment.id,
          message: `A cobrança deixou de ser editável no Asaas (${fresh.status}).`,
        });
        continue;
      }

      await updatePayment(
        payment.id,
        {
          billingType: fresh.billingType,
          value: fresh.value,
          dueDate: fresh.dueDate,
          ...termsPayload,
        },
        { contaId: input.contaId },
      );

      const confirmed = await getPayment(payment.id, { contaId: input.contaId });
      if (!EDITABLE_ASAAS_PAYMENT_STATUSES.includes(confirmed.status as (typeof EDITABLE_ASAAS_PAYMENT_STATUSES)[number])) {
        failures.push({
          paymentId: payment.id,
          message: `A atualização foi aceita, mas a cobrança mudou para ${confirmed.status}.`,
        });
        continue;
      }
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
