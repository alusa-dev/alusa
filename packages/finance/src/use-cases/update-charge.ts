/**
 * @module update-charge
 * @description Use-case para atualizar cobrança seguindo o padrão FASE 5:
 * - Read-before-write: verifica estado atual no Asaas
 * - Atualiza Asaas PRIMEIRO
 * - Atualiza local DEPOIS (com estado intermediário se necessário)
 * - Status final vem via webhook
 */

import { Prisma, StatusCobranca } from '@prisma/client';
import { prisma } from '@alusa/database';
import { updatePayment, isAsaasEnabled } from './asaas-ops';
import { auditLogService } from '../foundation/audit-log.service';
import type { CreatePaymentInput } from '@alusa/asaas';
import { randomUUID } from 'crypto';
import { readPaymentStatusPreflight } from './payment-command-preflight';

// Status que permitem edição
const EDITABLE_STATUSES = new Set<StatusCobranca>([
  StatusCobranca.PENDENTE,
  StatusCobranca.A_VENCER,
]);

// Status Asaas que permitem edição
const ASAAS_EDITABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);

export interface UpdateChargeInput {
  chargeId: string;
  contaId: string;
  userId: string;
  changes: {
    valor?: number;
    vencimento?: Date | string;
    descricao?: string;
    jurosPercentual?: number;
    multaPercentual?: number;
    descontoPercentual?: number;
    descontoValorFixo?: number;
    descontoPrazoMaximo?: string;
  };
}

export type UpdateChargeResult =
  | { success: true; data: { chargeId: string; asaasUpdated: boolean } }
  | { success: false; error: string; code: string };

/**
 * Atualiza uma cobrança seguindo o fluxo:
 * 1. Busca cobrança local + valida permissões
 * 2. Read-before-write no Asaas (se tiver asaasPaymentId)
 * 3. Atualiza no Asaas PRIMEIRO
 * 4. Atualiza local (sync=PENDING se aplicável)
 * 5. Auditoria
 */
export async function updateCharge(input: UpdateChargeInput): Promise<UpdateChargeResult> {
  const correlationId = randomUUID();
  const { chargeId, contaId, userId, changes } = input;

  // 1. Buscar cobrança local
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: chargeId, matricula: { aluno: { contaId } } },
    include: { matricula: { include: { aluno: { select: { contaId: true } } } } },
  });

  if (!cobranca) {
    return { success: false, error: 'Cobrança não encontrada', code: 'NOT_FOUND' };
  }

  // 2. Validar status local permite edição
  if (!EDITABLE_STATUSES.has(cobranca.status)) {
    return {
      success: false,
      error: `Cobrança com status ${cobranca.status} não pode ser editada`,
      code: 'STATUS_NOT_EDITABLE',
    };
  }

  let asaasUpdated = false;

  // 3. Se tem asaasPaymentId, aplicar read-before-write
  if (isAsaasEnabled() && cobranca.asaasPaymentId) {
    const asaasPayment = await readPaymentStatusPreflight(cobranca.asaasPaymentId, { contaId });

    // Verificar se Asaas permite edição
    if (!ASAAS_EDITABLE_STATUSES.has(asaasPayment.status)) {
      return {
        success: false,
        error: `Cobrança com status ${asaasPayment.status} no Asaas não pode ser editada`,
        code: 'ASAAS_STATUS_NOT_EDITABLE',
      };
    }

    // Montar payload para Asaas
    const asaasPayload = buildAsaasUpdatePayload(changes);

    if (Object.keys(asaasPayload).length > 0) {
      // ATUALIZA ASAAS PRIMEIRO
      await updatePayment(cobranca.asaasPaymentId, asaasPayload, { contaId });
      asaasUpdated = true;
    }
  }

  // 4. Atualizar local (apenas após sucesso no Asaas)
  const localUpdate = buildLocalUpdate(changes);
  await prisma.cobranca.update({
    where: { id: chargeId },
    data: localUpdate,
  });

  // 5. Auditoria
  await auditLogService.record({
    contaId,
    action: 'finance.charge.updated',
    entity: { type: 'Cobranca', id: chargeId },
    actor: { type: 'USER', id: userId },
    metadata: {
      correlationId,
      changes,
      asaasUpdated,
    },
  });

  return {
    success: true,
    data: { chargeId, asaasUpdated },
  };
}

function buildAsaasUpdatePayload(changes: UpdateChargeInput['changes']): Partial<CreatePaymentInput> {
  const payload: Partial<CreatePaymentInput> = {};

  if (changes.valor !== undefined) {
    payload.value = changes.valor;
  }

  if (changes.vencimento !== undefined) {
    const date = changes.vencimento instanceof Date ? changes.vencimento : new Date(changes.vencimento);
    payload.dueDate = date.toISOString().slice(0, 10);
  }

  if (changes.descricao !== undefined) {
    payload.description = changes.descricao;
  }

  if (changes.jurosPercentual !== undefined && changes.jurosPercentual >= 0) {
    payload.interest = { value: changes.jurosPercentual };
  }

  if (changes.multaPercentual !== undefined && changes.multaPercentual >= 0) {
    payload.fine = { value: changes.multaPercentual };
  }

  // Desconto
  if (changes.descontoPercentual !== undefined) {
    const dueDateLimitDays = parseDueDateLimitDays(changes.descontoPrazoMaximo);
    payload.discount = {
      value: Math.max(0, changes.descontoPercentual),
      type: 'PERCENTAGE',
      dueDateLimitDays,
    };
  } else if (changes.descontoValorFixo !== undefined) {
    const dueDateLimitDays = parseDueDateLimitDays(changes.descontoPrazoMaximo);
    payload.discount = {
      value: Math.max(0, changes.descontoValorFixo),
      type: 'FIXED',
      dueDateLimitDays,
    };
  }

  return payload;
}

function buildLocalUpdate(changes: UpdateChargeInput['changes']): Prisma.CobrancaUpdateInput {
  const update: Prisma.CobrancaUpdateInput = {};

  if (changes.valor !== undefined) update.valor = changes.valor;
  if (changes.vencimento !== undefined) {
    update.vencimento = changes.vencimento instanceof Date ? changes.vencimento : new Date(changes.vencimento);
  }
  if (changes.descricao !== undefined) update.descricao = changes.descricao;
  if (changes.jurosPercentual !== undefined) update.jurosPercentual = changes.jurosPercentual;
  if (changes.multaPercentual !== undefined) update.multaPercentual = changes.multaPercentual;
  if (changes.descontoPercentual !== undefined) update.descontoPercentual = changes.descontoPercentual;
  if (changes.descontoValorFixo !== undefined) update.descontoValorFixo = changes.descontoValorFixo;

  return update;
}

function parseDueDateLimitDays(prazoMaximo?: string): number {
  if (!prazoMaximo || prazoMaximo === 'ATE_VENCIMENTO') return 0;
  const match = prazoMaximo.match(/(\d+)_DIAS/);
  return match ? parseInt(match[1], 10) : 0;
}
