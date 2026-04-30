import type { Cobranca, Prisma } from '@prisma/client';
import {
  handlePaymentWebhook,
  listSubscriptionPayments,
  mapAsaasPaymentStatusToCobranca,
  recordAsaasReadIntent,
  type AsaasReadIntent,
} from '@alusa/finance';
import { prisma as appPrisma } from '@/src/prisma';

type CobrancaPersistence = {
  cobranca: {
    findFirst: (_args: Prisma.CobrancaFindFirstArgs) => Promise<{ id: string } | null>;
    update: (_args: Prisma.CobrancaUpdateArgs) => Promise<unknown>;
  };
};

type MaterializeSubscriptionPaymentInput = {
  prisma: CobrancaPersistence;
  contaId: string;
  asaasSubscriptionId: string;
  cobranca: {
    id: string;
    vencimento: Date;
    asaasPaymentId?: string | null;
  };
  intent: AsaasReadIntent;
};

export type MaterializeSubscriptionPaymentResult = {
  found: boolean;
  matchedBy: 'EXACT_DUE_DATE' | 'NEAREST_FUTURE' | 'FIRST_AVAILABLE' | null;
  payment: {
    id: string;
    status: string;
    dueDate: string;
    value: number;
    netValue: number;
    invoiceUrl: string | null;
    bankSlipUrl: string | null;
  } | null;
  linkedChargeId: string | null;
  updated: boolean;
};

export type SyncInitialSubscriptionPaymentResult = {
  found: boolean;
  processed: boolean;
  matchedBy: MaterializeSubscriptionPaymentResult['matchedBy'];
  payment: MaterializeSubscriptionPaymentResult['payment'];
  localCharge: Cobranca | null;
  error?: string;
};

function toDateKey(input: Date | string): string {
  if (typeof input === 'string') {
    return input.slice(0, 10);
  }

  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function selectBestSubscriptionPayment(
  payments: Awaited<ReturnType<typeof listSubscriptionPayments>>['data'],
  dueDate: Date,
) {
  if (!payments.length) {
    return { payment: null, matchedBy: null as MaterializeSubscriptionPaymentResult['matchedBy'] };
  }

  const targetKey = toDateKey(dueDate);
  const exact = payments.find((payment) => payment.dueDate === targetKey);
  if (exact) {
    return { payment: exact, matchedBy: 'EXACT_DUE_DATE' as const };
  }

  const future = [...payments]
    .filter((payment) => payment.dueDate >= targetKey)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  if (future.length > 0) {
    return { payment: future[0], matchedBy: 'NEAREST_FUTURE' as const };
  }

  const ordered = [...payments].sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  return { payment: ordered[0], matchedBy: 'FIRST_AVAILABLE' as const };
}

export async function syncInitialSubscriptionPaymentFromAsaas(input: {
  contaId: string;
  asaasSubscriptionId: string;
  targetDueDate: Date;
  intent: AsaasReadIntent;
}): Promise<SyncInitialSubscriptionPaymentResult> {
  recordAsaasReadIntent(input.intent);

  const subscriptionPayments = await listSubscriptionPayments(input.asaasSubscriptionId, {
    contaId: input.contaId,
    limit: 20,
  });

  const { payment, matchedBy } = selectBestSubscriptionPayment(
    subscriptionPayments.data,
    input.targetDueDate,
  );

  if (!payment) {
    return {
      found: false,
      processed: false,
      matchedBy: null,
      payment: null,
      localCharge: null,
    };
  }

  const webhookResult = await handlePaymentWebhook(input.contaId, {
    event: 'PAYMENT_CREATED',
    payment: {
      id: payment.id,
      status: payment.status as never,
      value: Number(payment.value ?? 0),
      netValue: Number(payment.netValue ?? 0),
      originalValue:
        typeof payment.originalValue === 'number' ? payment.originalValue : null,
      externalReference: payment.externalReference ?? undefined,
      description: payment.description ?? null,
      subscription: payment.subscription ?? input.asaasSubscriptionId,
      installment: payment.installment ?? null,
      installmentNumber:
        (payment as { installmentNumber?: number | null }).installmentNumber ?? null,
      dueDate: payment.dueDate ?? null,
      paymentDate: payment.paymentDate ?? null,
      clientPaymentDate: payment.clientPaymentDate ?? null,
      creditDate: payment.creditDate ?? null,
      estimatedCreditDate: payment.estimatedCreditDate ?? null,
      billingType: payment.billingType ?? null,
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
      deleted: typeof payment.deleted === 'boolean' ? payment.deleted : null,
    },
  });

  const localCharge = await appPrisma.cobranca.findFirst({
    where: { asaasPaymentId: payment.id },
  });

  return {
    found: true,
    processed: webhookResult.success,
    matchedBy,
    payment: {
      id: payment.id,
      status: payment.status,
      dueDate: payment.dueDate,
      value: Number(payment.value),
      netValue: Number(payment.netValue),
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
    },
    localCharge,
    error: webhookResult.success ? undefined : webhookResult.error,
  };
}

export async function materializeSubscriptionPaymentForCharge(
  input: MaterializeSubscriptionPaymentInput,
): Promise<MaterializeSubscriptionPaymentResult> {
  recordAsaasReadIntent(input.intent);

  const subscriptionPayments = await listSubscriptionPayments(input.asaasSubscriptionId, {
    contaId: input.contaId,
    limit: 20,
  });

  const { payment, matchedBy } = selectBestSubscriptionPayment(subscriptionPayments.data, input.cobranca.vencimento);
  if (!payment) {
    return {
      found: false,
      matchedBy: null,
      payment: null,
      linkedChargeId: null,
      updated: false,
    };
  }

  const existingCharge = await input.prisma.cobranca.findFirst({
    where: { asaasPaymentId: payment.id },
    select: { id: true },
  });

  if (existingCharge && existingCharge.id !== input.cobranca.id) {
    return {
      found: true,
      matchedBy,
      payment: {
        id: payment.id,
        status: payment.status,
        dueDate: payment.dueDate,
        value: Number(payment.value),
        netValue: Number(payment.netValue),
        invoiceUrl: payment.invoiceUrl ?? null,
        bankSlipUrl: payment.bankSlipUrl ?? null,
      },
      linkedChargeId: existingCharge.id,
      updated: false,
    };
  }

  await input.prisma.cobranca.update({
    where: { id: input.cobranca.id },
    data: {
      asaasPaymentId: payment.id,
      asaasStatus: payment.status,
      asaasValue: Number(payment.value),
      asaasNetValue: Number(payment.netValue),
      asaasOriginalValue: payment.originalValue != null ? Number(payment.originalValue) : null,
      asaasFeeValue:
        Number.isFinite(payment.value) && Number.isFinite(payment.netValue)
          ? Number((payment.value - payment.netValue).toFixed(2))
          : null,
      lastAsaasFetchAt: new Date(),
      status: mapAsaasPaymentStatusToCobranca(payment.status, {
        dueDate: input.cobranca.vencimento,
      }),
    },
  });

  return {
    found: true,
    matchedBy,
    payment: {
      id: payment.id,
      status: payment.status,
      dueDate: payment.dueDate,
      value: Number(payment.value),
      netValue: Number(payment.netValue),
      invoiceUrl: payment.invoiceUrl ?? null,
      bankSlipUrl: payment.bankSlipUrl ?? null,
    },
    linkedChargeId: input.cobranca.id,
    updated: true,
  };
}
