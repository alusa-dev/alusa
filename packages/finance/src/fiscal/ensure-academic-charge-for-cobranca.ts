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
    /** Alguns eventos de exclusão chegam com status não-terminal, mas deleted=true. */
    deleted?: boolean | null;
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
  // A recurring payment's raw externalReference can be the subscription's
  // parent reference, repeated by Asaas for every cycle. Charge references are
  // unique, so persist the payment-scoped form for recurring cycles.
  if (input.subscriptionExternalReference) {
    if (input.subscriptionExternalReference.endsWith(`:payment:${input.asaasPaymentId}`)) {
      return input.subscriptionExternalReference;
    }
    return buildPaymentExternalReference(input.subscriptionExternalReference, input.asaasPaymentId);
  }
  const paymentRef = input.payment?.externalReference?.trim();
  if (paymentRef) return paymentRef;
  return `charge:${input.cobrancaId}`;
}

function resolveChargeStatus(paymentStatus?: string | null): ReturnType<typeof mapAsaasToChargeStatus> {
  const normalized = paymentStatus?.trim().toUpperCase() ?? '';
  return mapAsaasToChargeStatus(normalized || 'PENDING');
}

function resolveInitialChargeStatus(
  persistedPaymentStatus: string | null | undefined,
  incomingPaymentStatus: string | null | undefined,
  deleted: boolean | null | undefined,
): ReturnType<typeof mapAsaasToChargeStatus> {
  if (deleted) return 'CANCELED';

  const persistedStatus = persistedPaymentStatus ? resolveChargeStatus(persistedPaymentStatus) : null;
  const incomingStatus = resolveChargeStatus(incomingPaymentStatus ?? persistedPaymentStatus);

  // Cobranca.asaasStatus is the durable local observation. A stale create
  // event must not seed a new Charge as open after the invoice was paid.
  if (persistedStatus === 'PAID' && ['OPEN', 'OVERDUE'].includes(incomingStatus)) {
    return persistedStatus;
  }

  return incomingStatus;
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

  // Payment identity is the first lookup for recurring cycle events.
  const existingByPayment = await prisma.charge.findFirst({
    where: { contaId: input.contaId, asaasPaymentId: input.asaasPaymentId },
    select: { id: true, cobrancaId: true },
  });

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
      matricula: {
        select: { alunoId: true, responsavelFinanceiroId: true },
      },
    },
  });

  if (!cobranca) return null;

  // Payment identity must win over the Cobranca identity. Never move an
  // existing provider payment to another academic invoice on retry/replay.
  if (existingByPayment && existingByPayment.cobrancaId !== cobranca.id) return null;

  const existingByCobranca = await prisma.charge.findFirst({
    where: {
      contaId: input.contaId,
      cobrancaId: cobranca.id,
    },
    select: { id: true, cobrancaId: true },
  });

  if (existingByCobranca && existingByCobranca.id !== existingByPayment?.id) {
    return null;
  }
  const existing = existingByPayment ?? existingByCobranca;

  const externalReference = resolveExternalReference(input);
  // O sinal `deleted` é terminal e prevalece sobre um status eventualmente
  // atrasado/inconsistente no payload do provedor. Isso evita recriar uma
  // cobrança local como aberta depois que o pagamento já foi excluído.
  const chargeStatus = resolveInitialChargeStatus(
    cobranca.asaasStatus,
    input.payment?.status,
    input.payment?.deleted,
  );
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
  const payerType = cobranca.matricula.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
  const payerId = cobranca.matricula.responsavelFinanceiroId ?? cobranca.matricula.alunoId;

  const charge = await prisma.charge.upsert({
    where: { cobrancaId: cobranca.id },
    update: {
      externalReference,
      asaasPaymentId: input.asaasPaymentId,
      billingType,
      dueDate,
      value,
      description,
      payerType,
      payerId,
      ...(invoiceUrl ? { invoiceUrl } : {}),
      // Existing status is advanced by the webhook state machine below. This
      // materializer must not reopen a paid Charge for a stale event snapshot.
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
      payerType,
      payerId,
      value,
      dueDate,
      billingType,
      invoiceUrl: invoiceUrl ?? null,
    },
    select: { id: true },
  });

  await chargeReadModelService.projectChargeReadModelByCobrancaId(cobranca.id, input.contaId).catch(() => undefined);

  return {
    chargeId: charge.id,
    created: !existing,
  };
}
