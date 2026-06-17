import type { PrismaClient } from '@prisma/client';
import {
  resolveOperationalChargePayment,
  type ResolvedOperationalChargePayment,
} from '@alusa/finance';

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

  const operational = await resolveOperationalChargePayment(contaId, id);
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
