/**
 * @module delete-charge
 * @description Use-case para deletar cobrança seguindo o padrão FASE 5:
 * - Read-before-write: verifica estado atual no Asaas
 * - Deleta no Asaas PRIMEIRO
 * - Soft delete local (status CANCELADO) para manter histórico
 * - Ou aguarda webhook PAYMENT_DELETED para confirmar
 */

import { Prisma, StatusCobranca } from '@prisma/client';
import { prisma } from '@alusa/database';
import { deletePayment, isAsaasEnabled } from './asaas-ops';
import { auditLogService } from '../foundation/audit-log.service';
import { randomUUID } from 'crypto';
import { readPaymentStatusPreflight } from './payment-command-preflight';

// Status que permitem deleção
const DELETABLE_STATUSES = new Set<StatusCobranca>([
  StatusCobranca.PENDENTE,
  StatusCobranca.A_VENCER,
]);

// Status Asaas que permitem deleção
const ASAAS_DELETABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);

export interface DeleteChargeInput {
  chargeId: string;
  contaId: string;
  userId: string;
  hardDelete?: boolean; // Se true, deleta do banco; se false, marca CANCELADO
}

export type DeleteChargeResult =
  | { success: true; data: { chargeId: string; asaasDeleted: boolean; hardDeleted: boolean } }
  | { success: false; error: string; code: string };

/**
 * Deleta uma cobrança seguindo o fluxo:
 * 1. Busca cobrança local + valida permissões
 * 2. Read-before-write no Asaas (se tiver asaasPaymentId)
 * 3. Deleta no Asaas PRIMEIRO
 * 4. Soft delete local (status CANCELADO) ou hard delete
 * 5. Auditoria
 */
export async function deleteCharge(input: DeleteChargeInput): Promise<DeleteChargeResult> {
  const correlationId = randomUUID();
  const { chargeId, contaId, userId, hardDelete = false } = input;

  // 1. Buscar cobrança local
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: chargeId, matricula: { aluno: { contaId } } },
    include: { matricula: { include: { aluno: { select: { contaId: true } } } } },
  });

  if (!cobranca) {
    return { success: false, error: 'Cobrança não encontrada', code: 'NOT_FOUND' };
  }

  // 2. Validar status local permite deleção
  if (!DELETABLE_STATUSES.has(cobranca.status)) {
    return {
      success: false,
      error: `Cobrança com status ${cobranca.status} não pode ser removida`,
      code: 'STATUS_NOT_DELETABLE',
    };
  }

  let asaasDeleted = false;

  // 3. Se tem asaasPaymentId, aplicar read-before-write e deletar no Asaas PRIMEIRO
  if (isAsaasEnabled() && cobranca.asaasPaymentId) {
    const asaasPayment = await readPaymentStatusPreflight(cobranca.asaasPaymentId, { contaId });

    // Verificar se Asaas permite deleção
    if (!ASAAS_DELETABLE_STATUSES.has(asaasPayment.status)) {
      return {
        success: false,
        error: `Cobrança com status ${asaasPayment.status} no Asaas não pode ser removida`,
        code: 'ASAAS_STATUS_NOT_DELETABLE',
      };
    }

    // DELETA NO ASAAS PRIMEIRO
    await deletePayment(cobranca.asaasPaymentId, { contaId });
    asaasDeleted = true;
  }

  // 4. Atualizar local (apenas após sucesso no Asaas)
  if (hardDelete) {
    // Hard delete: remove completamente do banco - MULTI-TENANT: validação atômica
    const result = await prisma.cobranca.deleteMany({
      where: { id: chargeId, matricula: { aluno: { contaId } } },
    });
    if (result.count === 0) {
      throw new Error('Cobrança não encontrada para exclusão');
    }
  } else {
    // Soft delete: marca como CANCELADO para manter histórico - MULTI-TENANT: validação atômica
    const result = await prisma.cobranca.updateMany({
      where: { id: chargeId, matricula: { aluno: { contaId } } },
      data: {
        status: StatusCobranca.CANCELADO,
        // Preservar timestamp de cancelamento
        canceladoEm: new Date(),
      } satisfies Prisma.CobrancaUpdateManyMutationInput,
    });
    if (result.count === 0) {
      throw new Error('Cobrança não encontrada para cancelamento');
    }
  }

  // 5. Auditoria
  await auditLogService.record({
    contaId,
    action: hardDelete ? 'finance.charge.hard_deleted' : 'finance.charge.soft_deleted',
    entity: { type: 'Cobranca', id: chargeId },
    actor: { type: 'USER', id: userId },
    metadata: {
      correlationId,
      asaasDeleted,
      hardDeleted: hardDelete,
      asaasPaymentId: cobranca.asaasPaymentId,
    },
  });

  return {
    success: true,
    data: { chargeId, asaasDeleted, hardDeleted: hardDelete },
  };
}
