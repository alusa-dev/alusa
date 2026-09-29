import type { FormaPagamento, Prisma, PrismaClient, StatusCobranca } from '@prisma/client';
import { upsertFinanceReconciliationIssue } from '@alusa/finance';

const EDITABLE_LOCAL_CHARGE_STATUSES: StatusCobranca[] = [
  'PENDENTE',
  'A_VENCER',
  'ATRASADO',
  'PROCESSANDO',
  'CANCELAMENTO_PENDENTE',
];

type Db = PrismaClient | Prisma.TransactionClient;

type Actor = {
  id?: string | null;
};

function parseDateOnlyAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function decimalInput(value: number): Prisma.Decimal | number {
  return value;
}

export async function markEnrollmentFinanceDivergence(input: {
  contaId: string;
  matriculaId: string;
  asaasSubscriptionId?: string | null;
  issue: 'SUBSCRIPTION_STATUS_DRIFT' | 'PAYMENT_STATUS_DRIFT';
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  localStatus?: string | null;
  remoteStatus?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: input.issue === 'SUBSCRIPTION_STATUS_DRIFT' ? 'SUBSCRIPTION' : 'PAYMENT',
    entityId: input.matriculaId,
    asaasId: input.asaasSubscriptionId ?? null,
    issueType: input.issue,
    severity: input.severity ?? 'HIGH',
    localStatus: input.localStatus ?? null,
    remoteStatus: input.remoteStatus ?? null,
    metadata: input.metadata,
  });
}

export async function cancelLocalFutureEnrollmentCharges(input: {
  db: Db;
  matriculaId: string;
  contaId: string;
  effectiveDate: string;
  actor: Actor;
  reason: string;
  canceledRemotePaymentIds?: string[];
  failedRemotePaymentIds?: string[];
  remoteDeletionUncertain?: boolean;
}) {
  const effectiveDate = parseDateOnlyAtNoon(input.effectiveDate);
  const canceledRemotePaymentIds = new Set(input.canceledRemotePaymentIds ?? []);
  const failedRemotePaymentIds = new Set(input.failedRemotePaymentIds ?? []);

  const charges = await input.db.cobranca.findMany({
    where: {
      matriculaId: input.matriculaId,
      vencimento: { gte: effectiveDate },
      status: { in: EDITABLE_LOCAL_CHARGE_STATUSES },
    },
    select: {
      id: true,
      asaasPaymentId: true,
    },
  });

  let canceled = 0;
  let pending = 0;

  for (const charge of charges) {
    const shouldRemainPending =
      charge.asaasPaymentId != null &&
      (input.remoteDeletionUncertain || failedRemotePaymentIds.has(charge.asaasPaymentId)) &&
      !canceledRemotePaymentIds.has(charge.asaasPaymentId);

    if (shouldRemainPending) {
      await input.db.cobranca.update({
        where: { id: charge.id },
        data: {
          status: 'CANCELAMENTO_PENDENTE',
          canceladoMotivo: input.reason,
          canceladoPor: input.actor.id ?? null,
        },
      });
      pending += 1;
      continue;
    }

    await input.db.cobranca.update({
      where: { id: charge.id },
      data: {
        status: 'CANCELADO',
        canceladoEm: new Date(),
        canceladoMotivo: input.reason,
        canceladoPor: input.actor.id ?? null,
      },
    });
    canceled += 1;
  }

  if (charges.length > 0) {
    await input.db.charge.updateMany({
      where: {
        contaId: input.contaId,
        cobrancaId: { in: charges.map((charge) => charge.id) },
      },
      data: {
        status: pending > 0 ? 'PENDING_SYNC' : 'CANCELED',
        statusUpdatedAt: new Date(),
      },
    });
  }

  return {
    scanned: charges.length,
    canceled,
    pending,
  };
}

export async function alignLocalPendingEnrollmentCharges(input: {
  db: Db;
  matriculaId: string;
  contaId: string;
  value?: number;
  billingType?: FormaPagamento | null;
  chargeBillingType?: string | null;
  dueDate?: string;
  interest?: { value: number; type: string } | null;
  fine?: { value: number; type: string } | null;
  discount?: { value: number; type: string; dueDateLimitDays: number } | null;
}) {
  const cobrancaData: Prisma.CobrancaUpdateManyMutationInput = {};
  const chargeData: Prisma.ChargeUpdateManyMutationInput = {};

  if (typeof input.value === 'number') {
    cobrancaData.valor = decimalInput(input.value);
    cobrancaData.valorFinal = decimalInput(input.value);
    chargeData.value = decimalInput(input.value);
  }

  if (input.billingType) {
    cobrancaData.formaPagamento = input.billingType;
    chargeData.billingType = input.chargeBillingType ?? input.billingType;
  } else if (input.chargeBillingType) {
    chargeData.billingType = input.chargeBillingType;
  }

  if (input.dueDate) {
    const dueDate = parseDateOnlyAtNoon(input.dueDate);
    cobrancaData.vencimento = dueDate;
    chargeData.dueDate = dueDate;
  }

  if (input.interest) {
    cobrancaData.jurosPercentual = input.interest.type === 'PERCENTAGE' ? decimalInput(input.interest.value) : null;
    cobrancaData.jurosValorFixo = input.interest.type === 'FIXED' ? decimalInput(input.interest.value) : null;
  }

  if (input.fine) {
    cobrancaData.multaTipo = input.fine.type === 'FIXED' ? 'VALOR_FIXO' : 'PERCENTUAL';
    cobrancaData.multaPercentual = input.fine.type === 'PERCENTAGE' ? decimalInput(input.fine.value) : null;
    cobrancaData.multaValorFixo = input.fine.type === 'FIXED' ? decimalInput(input.fine.value) : null;
  }

  if (input.discount) {
    cobrancaData.descontoTipo = input.discount.type === 'FIXED' ? 'VALOR_FIXO' : 'PERCENTUAL';
    cobrancaData.descontoPercentual =
      input.discount.type === 'PERCENTAGE' && input.discount.value > 0
        ? decimalInput(input.discount.value)
        : null;
    cobrancaData.descontoValorFixo =
      input.discount.type === 'FIXED' && input.discount.value > 0
        ? decimalInput(input.discount.value)
        : null;
    cobrancaData.descontoPrazoMaximo =
      input.discount.value > 0 && input.discount.dueDateLimitDays > 0
        ? `${input.discount.dueDateLimitDays}_DIAS`
        : 'ATE_VENCIMENTO';
  }

  if (Object.keys(cobrancaData).length === 0 && Object.keys(chargeData).length === 0) {
    return { cobrancasUpdated: 0, chargesUpdated: 0 };
  }

  const where = {
    matriculaId: input.matriculaId,
    status: { in: EDITABLE_LOCAL_CHARGE_STATUSES },
  };

  const [cobrancasResult, linkedChargesResult] = await Promise.all([
    input.db.cobranca.updateMany({
      where,
      data: cobrancaData,
    }),
    input.db.charge.updateMany({
      where: {
        contaId: input.contaId,
        cobranca: where,
      },
      data: chargeData,
    }),
  ]);

  return {
    cobrancasUpdated: cobrancasResult.count,
    chargesUpdated: linkedChargesResult.count,
  };
}
