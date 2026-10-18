import { getPayment, listSubscriptionPayments, updatePayment } from '../asaas-ops';
import { assertCompleteAsaasPage } from '../asaas-pagination';

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
  interest?: { value?: number | null } | null;
  fine?: { value?: number | null; type?: string | null } | null;
  discount?: { value?: number | null; type?: string | null; dueDateLimitDays?: number | null } | null;
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

function paymentTermsMatch(actual: SyncablePayment, expected: PaymentTerms) {
  if (expected.interest && Number(actual.interest?.value ?? 0) !== expected.interest.value) return false;
  if (expected.fine) {
    if (Number(actual.fine?.value ?? 0) !== expected.fine.value) return false;
    const expectedType = (expected.fine.type ?? 'PERCENTAGE').toUpperCase();
    if ((actual.fine?.type ?? 'PERCENTAGE').toUpperCase() !== expectedType) return false;
  }
  if (expected.discount) {
    if (Number(actual.discount?.value ?? 0) !== expected.discount.value) return false;
    const expectedType = (expected.discount.type ?? 'PERCENTAGE').toUpperCase();
    if ((actual.discount?.type ?? 'PERCENTAGE').toUpperCase() !== expectedType) return false;
    if (Number(actual.discount?.dueDateLimitDays ?? 0) !== (expected.discount.dueDateLimitDays ?? 0)) return false;
  }
  return true;
}

export async function syncEditableSubscriptionPayments(input: {
  contaId: string;
  asaasSubscriptionId: string;
  terms: PaymentTerms;
  assertLeaseOwned?: () => Promise<void>;
}) {
  const payments: SyncablePayment[] = [];

  for (const status of EDITABLE_ASAAS_PAYMENT_STATUSES) {
    let offset = 0;
    const limit = 100;
    let expectedTotalCount: number | undefined;

    let completed = false;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const page = await listSubscriptionPayments(input.asaasSubscriptionId, {
        contaId: input.contaId,
        status,
        limit,
        offset,
      });

      expectedTotalCount = assertCompleteAsaasPage(page, offset, limit, expectedTotalCount);
      if (!Array.isArray(page.data)) throw new Error('SUBSCRIPTION_PAYMENT_LOOKUP_INCOMPLETE:INVALID_DATA');

      payments.push(...(page.data as SyncablePayment[]).filter((payment) => !payment.deleted));
      if (!page.hasMore) {
        completed = true;
        break;
      }
      offset += limit;
    }
    if (!completed) throw new Error(`SUBSCRIPTION_PAYMENT_LOOKUP_INCOMPLETE:PAGE_LIMIT_REACHED:${status}`);
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

      await input.assertLeaseOwned?.();
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
      if (!paymentTermsMatch(confirmed as typeof confirmed & SyncablePayment, input.terms)) {
        failures.push({
          paymentId: payment.id,
          message: 'O Asaas manteve juros, multa ou desconto diferentes dos termos solicitados.',
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
