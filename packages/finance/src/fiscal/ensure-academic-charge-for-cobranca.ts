import type { FormaPagamento } from '@prisma/client';

import { buildPaymentExternalReference, mapAsaasToChargeStatus } from '../core';
import { chargeReadModelService } from '../read-model/charge-read-model.service';
import { getFiscalPrisma } from './fiscal-prisma';

export type EnsureAcademicChargeForCobrancaInput = {
  contaId: string;
  cobrancaId: string;
  asaasPaymentId: string;
  /** Referência da assinatura acadêmica, quando o pagamento é recorrente. */
  subscriptionExternalReference?: string | null;
  payment?: {
    status?: string | null;
    value?: number | null;
    dueDate?: string | null;
    billingType?: string | null;
    description?: string | null;
    invoiceUrl?: string | null;
    externalReference?: string | null;
  } | null;
};

export type EnsureAcademicChargeForCobrancaResult = {
  chargeId: string;
  created: boolean;
};

function mapFormaPagamentoToBillingType(forma: FormaPagamento): string {
  const map: Record<FormaPagamento, string> = {
    BOLETO: 'BOLETO',
    PIX: 'PIX',
    CARTAO_CREDITO: 'CREDIT_CARD',
    INDEFINIDO: 'UNDEFINED',
  };
  return map[forma] ?? 'UNDEFINED';
}

function resolveExternalReference(input: EnsureAcademicChargeForCobrancaInput): string {
  const paymentRef = input.payment?.externalReference?.trim();
  if (paymentRef) return paymentRef;
  if (input.subscriptionExternalReference) {
    return buildPaymentExternalReference(input.subscriptionExternalReference, input.asaasPaymentId);
  }
  return `charge:${input.cobrancaId}`;
}

function resolveChargeStatus(paymentStatus?: string | null): ReturnType<typeof mapAsaasToChargeStatus> {
  const normalized = paymentStatus?.trim().toUpperCase() ?? '';
  return mapAsaasToChargeStatus(normalized || 'PENDING');
}

/**
 * Garante registro `Charge` vinculado à cobrança acadêmica.
 * Cobranças avulsas (ex.: taxa de matrícula) criam pagamento no Asaas sem persistir Charge local;
 * a NFS-e automática depende desse vínculo.
 */
export async function ensureAcademicChargeForCobranca(
  input: EnsureAcademicChargeForCobrancaInput,
): Promise<EnsureAcademicChargeForCobrancaResult | null> {
  const prisma = getFiscalPrisma();

  const cobranca = await prisma.cobranca.findFirst({
    where: {
      id: input.cobrancaId,
      matricula: { aluno: { contaId: input.contaId } },
    },
    select: {
      id: true,
      descricao: true,
      valor: true,
      valorFinal: true,
      vencimento: true,
      formaPagamento: true,
      asaasStatus: true,
    },
  });

  if (!cobranca) return null;

  const existing = await prisma.charge.findFirst({
    where: {
      contaId: input.contaId,
      OR: [{ cobrancaId: cobranca.id }, { asaasPaymentId: input.asaasPaymentId }],
    },
    select: { id: true, cobrancaId: true },
  });

  if (existing && existing.cobrancaId && existing.cobrancaId !== cobranca.id) {
    return null;
  }

  const externalReference = resolveExternalReference(input);
  const paymentStatus = input.payment?.status ?? cobranca.asaasStatus;
  const chargeStatus = resolveChargeStatus(paymentStatus);
  const value =
    input.payment?.value != null
      ? input.payment.value
      : cobranca.valorFinal != null
        ? Number(cobranca.valorFinal)
        : Number(cobranca.valor);
  const dueDate =
    input.payment?.dueDate != null
      ? new Date(input.payment.dueDate)
      : cobranca.vencimento;
  const billingType =
    input.payment?.billingType ?? mapFormaPagamentoToBillingType(cobranca.formaPagamento);
  const description = input.payment?.description ?? cobranca.descricao ?? null;
  const invoiceUrl = input.payment?.invoiceUrl ?? undefined;

  const charge = await prisma.charge.upsert({
    where: { cobrancaId: cobranca.id },
    update: {
      externalReference,
      asaasPaymentId: input.asaasPaymentId,
      billingType,
      dueDate,
      value,
      description,
      ...(invoiceUrl ? { invoiceUrl } : {}),
      status: chargeStatus,
      statusUpdatedAt: new Date(),
    },
    create: {
      id: cobranca.id,
      contaId: input.contaId,
      cobrancaId: cobranca.id,
      externalReference,
      status: chargeStatus,
      statusUpdatedAt: new Date(),
      asaasPaymentId: input.asaasPaymentId,
      description,
      value,
      dueDate,
      billingType,
      invoiceUrl: invoiceUrl ?? null,
    },
    select: { id: true },
  });

  await chargeReadModelService.projectChargeReadModelByCobrancaId(cobranca.id).catch(() => undefined);

  return {
    chargeId: charge.id,
    created: !existing,
  };
}
