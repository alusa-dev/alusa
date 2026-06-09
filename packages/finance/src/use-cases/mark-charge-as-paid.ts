/**
 * @module mark-charge-as-paid
 * @description Use-case para marcar cobrança como paga manualmente (FASE 5):
 * - Se tem asaasPaymentId: usar confirmCashPayment (receber em dinheiro)
 * - Se não tem Asaas (offline puro): marcar local e sinalizar "fora do Asaas"
 * - Status final confirma via Asaas/webhook quando aplicável
 */

import { ChargeStatus, StatusCobranca } from '@prisma/client';
import { prisma } from '@alusa/database';
import { confirmCashPayment, isAsaasEnabled, getCurrentBrasiliaDate } from './asaas-ops';
import { auditLogService } from '../foundation/audit-log.service';
import { randomUUID } from 'crypto';
import { readPaymentStatusPreflight } from './payment-command-preflight';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';
import {
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  markPaymentCommandSent,
  registerPaymentCommand,
} from './payment-command-ledger';

// Status que permitem marcação como pago
const PAYABLE_STATUSES = new Set<StatusCobranca>([
  StatusCobranca.PENDENTE,
  StatusCobranca.A_VENCER,
  StatusCobranca.ATRASADO,
]);

const PAYABLE_CHARGE_STATUSES = new Set<ChargeStatus>([
  ChargeStatus.CREATED,
  ChargeStatus.PENDING_SYNC,
  ChargeStatus.OPEN,
  ChargeStatus.OVERDUE,
]);

// Status Asaas que permitem recebimento em dinheiro
const ASAAS_RECEIVABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);
const ASAAS_ALREADY_PAID_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED']);

function resolvePaymentDateString(dataPagamento: Date | string | undefined): string | null {
  if (!dataPagamento) return getCurrentBrasiliaDate().dateStr;

  if (dataPagamento instanceof Date) {
    return Number.isNaN(dataPagamento.getTime()) ? null : dataPagamento.toISOString().slice(0, 10);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
    const date = new Date(`${dataPagamento}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : dataPagamento;
  }

  const parsed = new Date(dataPagamento);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

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
  | {
      success: true;
      data: {
        chargeId: string;
        entityType: 'Cobranca' | 'Charge';
        asaasProcessed: boolean;
        isOffline: boolean;
      };
    }
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

  // 1. Buscar cobrança acadêmica local
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: chargeId, matricula: { aluno: { contaId } } },
    include: { matricula: { include: { aluno: { select: { contaId: true } } } } },
  });

  const standaloneCharge = !cobranca
    ? await prisma.charge.findFirst({
        where: { id: chargeId, contaId },
        select: {
          id: true,
          contaId: true,
          status: true,
          asaasPaymentId: true,
          value: true,
        },
      })
    : null;

  if (!cobranca && !standaloneCharge) {
    return { success: false, error: 'Cobrança não encontrada', code: 'NOT_FOUND' };
  }

  const entityType = cobranca ? 'Cobranca' : 'Charge';
  const commandEntityType = cobranca ? 'COBRANCA' : 'CHARGE';
  const entityId = cobranca?.id ?? standaloneCharge!.id;
  const asaasPaymentId = cobranca?.asaasPaymentId ?? standaloneCharge?.asaasPaymentId ?? null;
  const amount = Number(cobranca?.valor ?? standaloneCharge?.value ?? 0);

  // Já paga?
  if (cobranca?.status === StatusCobranca.PAGO || standaloneCharge?.status === ChargeStatus.PAID) {
    return { success: false, error: 'Cobrança já está paga', code: 'ALREADY_PAID' };
  }

  // Validar status permite marcação
  if (cobranca && !PAYABLE_STATUSES.has(cobranca.status)) {
    return {
      success: false,
      error: `Cobrança com status ${cobranca.status} não pode ser marcada como paga`,
      code: 'STATUS_NOT_PAYABLE',
    };
  }
  if (standaloneCharge && !PAYABLE_CHARGE_STATUSES.has(standaloneCharge.status)) {
    return {
      success: false,
      error: `Cobrança com status ${standaloneCharge.status} não pode ser marcada como paga`,
      code: 'STATUS_NOT_PAYABLE',
    };
  }

  const paymentDateStr = resolvePaymentDateString(dataPagamento);
  if (!paymentDateStr) {
    return { success: false, error: 'Data de pagamento inválida', code: 'INVALID_PAYMENT_DATE' };
  }

  let asaasProcessed = false;
  let isOffline = true;
  let idempotentAlreadyPaid = false;
  let commandJobId: string | null = null;

  // 2. Se tem asaasPaymentId e Asaas habilitado
  if (isAsaasEnabled() && asaasPaymentId) {
    // Read-before-write
    const asaasPayment = await readPaymentStatusPreflight(asaasPaymentId, { contaId });

    if (ASAAS_ALREADY_PAID_STATUSES.has(asaasPayment.status)) {
      const eventName = asaasPayment.status === 'RECEIVED_IN_CASH'
        ? 'PAYMENT_RECEIVED_IN_CASH'
        : 'PAYMENT_RECEIVED';
      const syncResult = await syncPaymentStateFromAsaas({
        contaId,
        asaasPaymentId,
        eventName,
      });

      if (!syncResult.success) {
        return {
          success: false,
          error: `Cobrança já está paga no Asaas (${asaasPayment.status}), mas a sincronização local falhou`,
          code: 'ASAAS_ALREADY_PAID_SYNC_FAILED',
        };
      }

      asaasProcessed = true;
      isOffline = false;
      idempotentAlreadyPaid = true;
    } else if (!ASAAS_RECEIVABLE_STATUSES.has(asaasPayment.status)) {
      return {
        success: false,
        error: `Cobrança com status ${asaasPayment.status} no Asaas não pode ser marcada como paga`,
        code: 'ASAAS_STATUS_NOT_RECEIVABLE',
      };
    } else {
      const command = await registerPaymentCommand({
        contaId,
        type: 'PAYMENT_MARK_CASH_COMMAND',
        entityType: commandEntityType,
        entityId,
        asaasPaymentId,
        expectedEvents: expectedEventsForPaymentCommand('PAYMENT_MARK_CASH_COMMAND'),
        correlationId,
        actorId: userId,
        chargeId: standaloneCharge?.id ?? null,
        cobrancaId: cobranca?.id ?? null,
        metadata: {
          paymentDate: paymentDateStr,
          amount,
          notifyCustomer,
        },
      });
      commandJobId = command.id;

      // Chamar confirmCashPayment no Asaas
      try {
        await confirmCashPayment(
          asaasPaymentId,
          paymentDateStr,
          amount,
          notifyCustomer,
          { contaId },
        );
        await markPaymentCommandSent({
          jobId: command.id,
          providerStatus: asaasPayment.status,
        });
      } catch (error) {
        await failPaymentCommand({ jobId: command.id, error });
        throw error;
      }

      asaasProcessed = true;
      isOffline = false;

      // Status final virá via webhook PAYMENT_RECEIVED / PAYMENT_RECEIVED_IN_CASH
      // Não atualizamos status local aqui - webhook faz isso
    }
  } else {
    // 3. Offline: não tem Asaas, marcar local
    await prisma.$transaction(async (tx) => {
      if (cobranca) {
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
        return;
      }

      const updateResult = await tx.charge.updateMany({
        where: { id: chargeId, contaId },
        data: {
          status: ChargeStatus.PAID,
          statusUpdatedAt: new Date(paymentDateStr),
        },
      });

      if (updateResult.count === 0) {
        throw new Error('Cobrança não encontrada ou não pertence à conta');
      }
    });
  }

  // 4. Auditoria
  await auditLogService.record({
    contaId,
    action: isOffline ? 'finance.charge.marked_paid_offline' : 'finance.charge.cash_payment_requested',
    entity: { type: entityType, id: entityId },
    actor: { type: 'USER', id: userId },
    metadata: {
      correlationId,
      commandJobId,
      asaasProcessed,
      isOffline,
      paymentDate: paymentDateStr,
      formaPagamento: formaPagamentoManual,
      observacao,
      idempotentAlreadyPaid,
    },
  });

  return {
    success: true,
    data: { chargeId: entityId, entityType, asaasProcessed, isOffline },
  };
}
