/**
 * @module mark-charge-as-paid
 * @description Use-case para marcar cobrança como paga manualmente (FASE 5):
 * - Se tem asaasPaymentId: usar confirmCashPayment (receber em dinheiro)
 * - Se não tem Asaas (offline puro): marcar local e sinalizar "fora do Asaas"
 * - Status final confirma via Asaas/webhook quando aplicável
 */

import { StatusCobranca } from '@prisma/client';
import { prisma } from '@alusa/database';
import { confirmCashPayment, isAsaasEnabled, getCurrentBrasiliaDate } from './asaas-ops';
import { auditLogService } from '../foundation/audit-log.service';
import { randomUUID } from 'crypto';
import { readPaymentStatusPreflight } from './payment-command-preflight';

// Status que permitem marcação como pago
const PAYABLE_STATUSES = new Set<StatusCobranca>([
  StatusCobranca.PENDENTE,
  StatusCobranca.A_VENCER,
]);

// Status Asaas que permitem recebimento em dinheiro
const ASAAS_RECEIVABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);

export interface MarkChargeAsPaidInput {
  chargeId: string;
  contaId: string;
  userId: string;
  dataPagamento?: Date | string;
  formaPagamentoManual?: 'DINHEIRO' | 'PIX' | 'TRANSFERENCIA';
  observacao?: string;
  notifyCustomer?: boolean;
}

export type MarkChargeAsPaidResult =
  | { success: true; data: { chargeId: string; asaasProcessed: boolean; isOffline: boolean } }
  | { success: false; error: string; code: string };

/**
 * Marca cobrança como paga seguindo o fluxo:
 * 1. Busca cobrança local
 * 2. Se tem asaasPaymentId:
 *    a. Read-before-write no Asaas
 *    b. Chama confirmCashPayment
 *    c. Status final virá via webhook
 * 3. Se não tem Asaas (offline):
 *    a. Marca local como PAGO
 *    b. Sinaliza como "recebido fora do Asaas"
 * 4. Auditoria
 */
export async function markChargeAsPaid(input: MarkChargeAsPaidInput): Promise<MarkChargeAsPaidResult> {
  const correlationId = randomUUID();
  const {
    chargeId,
    contaId,
    userId,
    dataPagamento,
    formaPagamentoManual = 'DINHEIRO',
    observacao,
    notifyCustomer = false,
  } = input;

  // 1. Buscar cobrança local
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: chargeId, matricula: { aluno: { contaId } } },
    include: { matricula: { include: { aluno: { select: { contaId: true } } } } },
  });

  if (!cobranca) {
    return { success: false, error: 'Cobrança não encontrada', code: 'NOT_FOUND' };
  }

  // Já paga?
  if (cobranca.status === StatusCobranca.PAGO) {
    return { success: false, error: 'Cobrança já está paga', code: 'ALREADY_PAID' };
  }

  // Validar status permite marcação
  if (!PAYABLE_STATUSES.has(cobranca.status)) {
    return {
      success: false,
      error: `Cobrança com status ${cobranca.status} não pode ser marcada como paga`,
      code: 'STATUS_NOT_PAYABLE',
    };
  }

  const paymentDateStr = dataPagamento
    ? (dataPagamento instanceof Date ? dataPagamento : new Date(dataPagamento)).toISOString().slice(0, 10)
    : getCurrentBrasiliaDate().dateStr;

  let asaasProcessed = false;
  let isOffline = true;

  // 2. Se tem asaasPaymentId e Asaas habilitado
  if (isAsaasEnabled() && cobranca.asaasPaymentId) {
    // Read-before-write
    const asaasPayment = await readPaymentStatusPreflight(cobranca.asaasPaymentId, { contaId });

    if (!ASAAS_RECEIVABLE_STATUSES.has(asaasPayment.status)) {
      return {
        success: false,
        error: `Cobrança com status ${asaasPayment.status} no Asaas não pode ser marcada como paga`,
        code: 'ASAAS_STATUS_NOT_RECEIVABLE',
      };
    }

    // Chamar confirmCashPayment no Asaas
    await confirmCashPayment(
      cobranca.asaasPaymentId,
      paymentDateStr,
      Number(cobranca.valor),
      notifyCustomer,
      { contaId },
    );

    asaasProcessed = true;
    isOffline = false;

    // Status final virá via webhook PAYMENT_RECEIVED / PAYMENT_RECEIVED_IN_CASH
    // Não atualizamos status local aqui - webhook faz isso
  } else {
    // 3. Offline: não tem Asaas, marcar local
    await prisma.$transaction(async (tx) => {
      // Atualizar cobrança - MULTI-TENANT: validação atômica
      const updateResult = await tx.cobranca.updateMany({
        where: { id: chargeId, matricula: { aluno: { contaId } } },
        data: {
          status: StatusCobranca.PAGO,
          dataPagamento: new Date(paymentDateStr),
          formaPagamento: 'INDEFINIDO', // Marcado manualmente
        },
      });

      if (updateResult.count === 0) {
        throw new Error('Cobrança não encontrada ou não pertence à conta');
      }

      // Criar registro de pagamento
      await tx.pagamento.create({
        data: {
          contaId,
          cobrancaId: chargeId,
          valorPago: cobranca.valor,
          dataPagamento: new Date(paymentDateStr),
          formaPagamento: formaPagamentoManual,
          status: 'CONFIRMADO',
          // observacao registrada apenas na auditoria (Pagamento não tem esse campo)
        },
      });
    });
  }

  // 4. Auditoria
  await auditLogService.record({
    contaId,
    action: isOffline ? 'finance.charge.marked_paid_offline' : 'finance.charge.cash_payment_requested',
    entity: { type: 'Cobranca', id: chargeId },
    actor: { type: 'USER', id: userId },
    metadata: {
      correlationId,
      asaasProcessed,
      isOffline,
      paymentDate: paymentDateStr,
      formaPagamento: formaPagamentoManual,
      observacao,
    },
  });

  return {
    success: true,
    data: { chargeId, asaasProcessed, isOffline },
  };
}
