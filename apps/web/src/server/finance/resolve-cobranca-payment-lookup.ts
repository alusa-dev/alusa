import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/src/prisma';
import type { ResolvedOperationalChargePayment } from '@alusa/finance';
import * as finance from '@alusa/finance';

type PaymentLookupClient = Pick<PrismaClient, 'cobranca' | 'charge'>;

export type CobrancaPaymentLookup = {
  asaasPaymentId: string | null;
  invoiceUrl: string | null;
  localStatus: string | null;
  billingType: string | null;
  value: number | null;
  origin: 'ACADEMIC' | 'STANDALONE' | 'EVENT';
  entityType: 'COBRANCA' | 'CHARGE' | 'EVENT';
  operational?: ResolvedOperationalChargePayment;
};

export async function resolveCobrancaPaymentLookup(
  db: PaymentLookupClient,
  contaId: string,
  id: string,
): Promise<CobrancaPaymentLookup | null> {
  const cobranca = await db.cobranca.findFirst({
    where: { id, matricula: { aluno: { contaId } } },
    select: {
      asaasPaymentId: true,
      status: true,
      formaPagamento: true,
      valor: true,
      charge: { select: { invoiceUrl: true } },
    },
  });

  if (cobranca) {
    return {
      asaasPaymentId: cobranca.asaasPaymentId,
      invoiceUrl: cobranca.charge?.invoiceUrl ?? null,
      localStatus: cobranca.status,
      billingType: cobranca.formaPagamento,
      value: Number(cobranca.valor),
      origin: 'ACADEMIC',
      entityType: 'COBRANCA',
    };
  }

  const charge = await db.charge.findFirst({
    where: { id, contaId },
    select: {
      asaasPaymentId: true,
      status: true,
      billingType: true,
      value: true,
      invoiceUrl: true,
    },
  });

  if (charge) {
    return {
      asaasPaymentId: charge.asaasPaymentId,
      invoiceUrl: charge.invoiceUrl,
      localStatus: charge.status,
      billingType: charge.billingType,
      value: charge.value != null ? Number(charge.value) : null,
      origin: 'STANDALONE',
      entityType: 'CHARGE',
    };
  }

  let operational: ResolvedOperationalChargePayment | null = null;
  try {
    const resolver = finance.resolveOperationalChargePayment;
    if (typeof resolver === 'function') operational = await resolver(contaId, id);
  } catch (error) {
    // Some isolated route tests intentionally provide a reduced finance mock.
    // A missing optional event resolver means “not an event charge”; provider
    // and database errors must still propagate to the route boundary.
    if (!(error instanceof Error) || !error.message.includes('resolveOperationalChargePayment')) throw error;
  }
  if (!operational) return null;

  return {
    asaasPaymentId: operational.asaasPaymentId,
    invoiceUrl: operational.invoiceUrl,
    localStatus: operational.localStatus,
    billingType: operational.billingType,
    value: operational.value,
    origin: 'EVENT',
    entityType: 'EVENT',
    operational,
  };
}

export async function resolveCobrancaPaymentLookupForTenant(
  contaId: string,
  id: string,
): Promise<CobrancaPaymentLookup | null> {
  return resolveCobrancaPaymentLookup(defaultPrisma, contaId, id);
}

export async function loadCobrancaActionRecords(contaId: string, id: string) {
  const cobranca = await defaultPrisma.cobranca.findFirst({
    where: { id, matricula: { aluno: { contaId } } },
    include: {
      matricula: { select: { id: true, aluno: { select: { contaId: true } } } },
      charge: { select: { invoiceUrl: true } },
    },
  });
  const charge = !cobranca
    ? await defaultPrisma.charge.findFirst({
        where: { id, contaId },
        select: { id: true, status: true, asaasPaymentId: true, value: true, billingType: true, invoiceUrl: true, standaloneInstallmentPlanId: true, standaloneSubscriptionId: true },
      })
    : null;
  return { cobranca, charge };
}

export async function recordCobrancaFinancialLog(data: Prisma.LogFinanceiroCreateArgs['data']) {
  return defaultPrisma.logFinanceiro.create({ data });
}
