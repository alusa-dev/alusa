/**
 * Matricula Finance Status Guard
 *
 * Blindagem para garantir que apenas handlers de PAYMENT e SUBSCRIPTION
 * podem alterar o campo matricula.financeStatus.
 *
 * Princípios:
 * - Não modifica lógica interna dos handlers atuais
 * - Valida "caller category" antes de permitir alteração
 * - Registra log de segurança em tentativas indevidas
 * - Fail-safe: bloqueia mas não quebra o sistema
 */

import { prisma } from '@alusa/database';
import type { StatusFinanceiro } from '@prisma/client';
import type { EventCategory } from '../webhooks/asaas-event-registry';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Categorias autorizadas a alterar financeStatus
 */
const AUTHORIZED_CATEGORIES: EventCategory[] = ['PAYMENT', 'SUBSCRIPTION'];

export interface UpdateFinanceStatusInput {
  matriculaId: string;
  newStatus: StatusFinanceiro;
  /** Categoria do evento que está solicitando a alteração */
  eventCategory: EventCategory | 'UNKNOWN';
  /** Nome do evento para auditoria */
  eventName?: string;
  /** Motivo da alteração */
  reason?: string;
}

export interface UpdateFinanceStatusResult {
  success: boolean;
  previousStatus?: StatusFinanceiro;
  newStatus?: StatusFinanceiro;
  blocked?: boolean;
  blockReason?: string;
}

export interface FinanceStatusGuardContext {
  eventCategory: EventCategory | 'UNKNOWN';
  eventName?: string;
  contaId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se uma categoria está autorizada a alterar financeStatus
 */
export function isAuthorizedCategory(category: EventCategory | 'UNKNOWN'): boolean {
  return AUTHORIZED_CATEGORIES.includes(category as EventCategory);
}

/**
 * Valida se a alteração de financeStatus é permitida
 */
export function validateFinanceStatusChange(
  context: FinanceStatusGuardContext
): { allowed: boolean; reason?: string } {
  if (!isAuthorizedCategory(context.eventCategory)) {
    return {
      allowed: false,
      reason: `Categoria ${context.eventCategory} não autorizada a alterar financeStatus. Apenas PAYMENT e SUBSCRIPTION são permitidos.`,
    };
  }
  return { allowed: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra tentativa bloqueada de alteração de financeStatus
 */
function logBlockedAttempt(params: {
  matriculaId: string;
  eventCategory: EventCategory | 'UNKNOWN';
  eventName?: string;
  requestedStatus: StatusFinanceiro;
  reason: string;
}): void {
  try {
    console.error(
      JSON.stringify({
        level: 'security',
        type: 'finance_status_change_blocked',
        timestamp: new Date().toISOString(),
        matriculaId: params.matriculaId,
        eventCategory: params.eventCategory,
        eventName: params.eventName,
        requestedStatus: params.requestedStatus,
        reason: params.reason,
      })
    );
  } catch {
    // Fail-safe
  }
}

/**
 * Registra alteração bem-sucedida de financeStatus
 */
function logStatusChange(params: {
  matriculaId: string;
  eventCategory: EventCategory | 'UNKNOWN';
  eventName?: string;
  previousStatus: StatusFinanceiro;
  newStatus: StatusFinanceiro;
  reason?: string;
}): void {
  try {
    console.log(
      JSON.stringify({
        level: 'info',
        type: 'finance_status_changed',
        timestamp: new Date().toISOString(),
        ...params,
      })
    );
  } catch {
    // Fail-safe
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Atualiza financeStatus de uma matrícula com validação de categoria
 *
 * IMPORTANTE: Este é o único ponto de alteração autorizado do financeStatus.
 * Handlers devem usar este serviço ao invés de update direto no Prisma.
 */
export async function updateMatriculaFinanceStatus(
  input: UpdateFinanceStatusInput
): Promise<UpdateFinanceStatusResult> {
  const { matriculaId, newStatus, eventCategory, eventName, reason } = input;

  // 1. Validar categoria
  const validation = validateFinanceStatusChange({ eventCategory, eventName });

  if (!validation.allowed) {
    logBlockedAttempt({
      matriculaId,
      eventCategory,
      eventName,
      requestedStatus: newStatus,
      reason: validation.reason ?? 'Categoria não autorizada',
    });

    return {
      success: false,
      blocked: true,
      blockReason: validation.reason,
    };
  }

  // 2. Buscar matrícula atual
  const matricula = await prisma.matricula.findUnique({
    where: { id: matriculaId },
    select: { id: true, statusFinanceiro: true },
  });

  if (!matricula) {
    return {
      success: false,
      blocked: false,
      blockReason: 'Matrícula não encontrada',
    };
  }

  const previousStatus = matricula.statusFinanceiro;

  // 3. Verificar se é a mesma (idempotência)
  if (previousStatus === newStatus) {
    return {
      success: true,
      previousStatus,
      newStatus,
    };
  }

  // 4. Atualizar
  await prisma.matricula.update({
    where: { id: matriculaId },
    data: { statusFinanceiro: newStatus },
  });

  // 5. Log de alteração
  logStatusChange({
    matriculaId,
    eventCategory,
    eventName,
    previousStatus,
    newStatus,
    reason,
  });

  return {
    success: true,
    previousStatus,
    newStatus,
  };
}

/**
 * Wrapper para usar em handlers de PAYMENT
 */
export async function updateFinanceStatusFromPayment(params: {
  matriculaId: string;
  newStatus: StatusFinanceiro;
  eventName: string;
  reason?: string;
}): Promise<UpdateFinanceStatusResult> {
  return updateMatriculaFinanceStatus({
    ...params,
    eventCategory: 'PAYMENT',
  });
}

/**
 * Wrapper para usar em handlers de SUBSCRIPTION
 */
export async function updateFinanceStatusFromSubscription(params: {
  matriculaId: string;
  newStatus: StatusFinanceiro;
  eventName: string;
  reason?: string;
}): Promise<UpdateFinanceStatusResult> {
  return updateMatriculaFinanceStatus({
    ...params,
    eventCategory: 'SUBSCRIPTION',
  });
}

/**
 * Tenta atualizar financeStatus a partir de qualquer categoria
 * Útil para testes e para validar bloqueio
 */
export async function tryUpdateFinanceStatus(params: {
  matriculaId: string;
  newStatus: StatusFinanceiro;
  eventCategory: EventCategory | 'UNKNOWN';
  eventName?: string;
}): Promise<UpdateFinanceStatusResult> {
  return updateMatriculaFinanceStatus({
    ...params,
  });
}
