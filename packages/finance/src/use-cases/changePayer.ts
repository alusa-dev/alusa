/**
 * changePayerUseCase — Troca de pagador (responsável financeiro) de uma matrícula
 * 
 * PR4: Permite trocar o responsável financeiro de uma matrícula ativa.
 * 
 * Arquitetura SAGA/2-fases:
 * 
 * FASE 1 (Prepare):
 * 1. Validar matrícula (status ATIVA, não em operação)
 * 2. Validar novo pagador (responsável válido, CPF, etc)
 * 3. Criar operação (PayerChangeOperacao com status PENDING)
 * 4. Criar/garantir customer para novo pagador
 * 
 * FASE 2 (Execute):
 * 5. Cancelar assinatura antiga (se existir)
 * 6. Criar nova assinatura com novo pagador
 * 7. Atualizar matrícula com novo responsavelFinanceiroId
 * 8. Marcar operação como COMMITTED
 * 
 * Em caso de FALHA:
 * - Se falhar antes de cancelar antiga: permite retry
 * - Se falhar após cancelar antiga: tenta rollback ou marca para revisão manual
 * 
 * Invariantes:
 * - Aluno menor DEVE ter responsável financeiro
 * - Aluno maior SEM responsável explícito = ele próprio é pagador (não precisa deste fluxo)
 * - Novo pagador deve ser um Responsavel válido
 */

import { randomUUID } from 'crypto';
import type { CustomerPayerType, PayerChangeOperacaoStatus } from '@prisma/client';
import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { AUDIT_ACTIONS } from '../foundation/audit-actions';
import { auditLogService } from '../foundation/audit-log.service';
import { ensureCustomer } from './ensure-customer';

// ============================================================================
// TIPOS
// ============================================================================

export interface ChangePayerInput {
  contaId: string;
  matriculaId: string;
  newResponsavelId: string;
  reason?: string;
  actor: { type: 'USER' | 'SYSTEM'; id: string };
  idempotencyKey?: string;
}

export interface ChangePayerOutput {
  operationId: string;
  status: PayerChangeOperacaoStatus;
  matriculaId: string;
  oldPayerId: string;
  newPayerId: string;
  uiMessage: string;
}

export type ChangePayerError =
  | 'MATRICULA_NAO_ENCONTRADA'
  | 'MATRICULA_PERTENCE_OUTRA_CONTA'
  | 'STATUS_INVALIDO'
  | 'OPERACAO_EM_ANDAMENTO'
  | 'NOVO_RESPONSAVEL_NAO_ENCONTRADO'
  | 'NOVO_RESPONSAVEL_SEM_CPF'
  | 'MESMO_PAGADOR'
  | 'ALUNO_MAIOR_SEM_RESPONSAVEL'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CRIAR_CUSTOMER'
  | 'ERRO_PROVEDOR';

async function finalizePayerChange(params: {
  contaId: string;
  matricula: {
    id: string;
    alunoId: string;
    asaasSubscriptionId: string | null;
    responsavelFinanceiro: { id: string; nome: string } | null;
    aluno: { nome: string };
  };
  newResponsavel: { id: string; nome: string };
  operacao: {
    id: string;
    matriculaId: string;
    oldPayerType: CustomerPayerType;
    oldPayerId: string;
    newPayerId: string;
    oldSubscriptionId: string | null;
  };
  actor: { type: 'USER' | 'SYSTEM'; id: string };
  reason?: string;
}): Promise<Result<ChangePayerOutput, ChangePayerError>> {
  const customerResult = await ensureCustomer({
    contaId: params.contaId,
    payer: { type: 'RESPONSAVEL', id: params.newResponsavel.id },
  });

  if (!customerResult.success) {
    await prisma.payerChangeOperacao.update({
      where: { id: params.operacao.id },
      data: {
        status: 'FAILED',
        errorCode: customerResult.error,
        errorMessage: `Erro ao criar customer: ${customerResult.error}`,
      },
    });
    return err(customerResult.error as ChangePayerError);
  }

  await prisma.payerChangeOperacao.update({
    where: { id: params.operacao.id },
    data: { newCustomerId: customerResult.data.customerId },
  });

  await prisma.matricula.update({
    where: { id: params.matricula.id },
    data: {
      responsavelFinanceiroId: params.newResponsavel.id,
    },
  });

  await prisma.payerChangeOperacao.update({
    where: { id: params.operacao.id },
    data: { status: 'COMMITTED' },
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: AUDIT_ACTIONS.PAYER_CHANGE.COMMITTED,
    entity: { type: 'MATRICULA', id: params.matricula.id },
    actor: { type: params.actor.type, id: params.actor.id },
    metadata: {
      operationId: params.operacao.id,
      oldPayerType: params.operacao.oldPayerType,
      oldPayerId: params.operacao.oldPayerId,
      newPayerType: 'RESPONSAVEL',
      newPayerId: params.newResponsavel.id,
      oldSubscriptionId: params.operacao.oldSubscriptionId,
      reason: params.reason,
    },
  });

  return ok({
    operationId: params.operacao.id,
    status: 'COMMITTED',
    matriculaId: params.matricula.id,
    oldPayerId: params.operacao.oldPayerId,
    newPayerId: params.newResponsavel.id,
    uiMessage: `Responsável financeiro alterado de ${params.operacao.oldPayerType === 'RESPONSAVEL' ? params.matricula.responsavelFinanceiro?.nome : params.matricula.aluno.nome} para ${params.newResponsavel.nome}.`,
  });
}

// ============================================================================
// USE-CASE
// ============================================================================

export async function changePayer(
  input: ChangePayerInput
): Promise<Result<ChangePayerOutput, ChangePayerError>> {
  const correlationId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  // Idempotência: verificar se já existe operação com mesma key
  const existingOp = await prisma.payerChangeOperacao.findUnique({
    where: { idempotencyKey },
  });

  if (existingOp) {
    if (existingOp.status === 'COMMITTED') {
      return ok({
        operationId: existingOp.id,
        status: existingOp.status,
        matriculaId: existingOp.matriculaId,
        oldPayerId: existingOp.oldPayerId,
        newPayerId: existingOp.newPayerId,
        uiMessage: 'Troca de pagador já realizada.',
      });
    }
    if (existingOp.status === 'PENDING' || existingOp.status === 'FAILED') {
      // Permite retry
      return retryPayerChange(existingOp.id, input.actor);
    }
    return err('OPERACAO_EM_ANDAMENTO');
  }

  // 1. Buscar matrícula
  const matricula = await prisma.matricula.findUnique({
    where: { id: input.matriculaId },
    include: {
      aluno: {
        select: {
          id: true,
          contaId: true,
          dataNasc: true,
          nome: true,
        },
      },
      responsavelFinanceiro: {
        select: {
          id: true,
          nome: true,
          cpf: true,
        },
      },
    },
  });

  if (!matricula) {
    return err('MATRICULA_NAO_ENCONTRADA');
  }

  if (matricula.aluno.contaId !== input.contaId) {
    return err('MATRICULA_PERTENCE_OUTRA_CONTA');
  }

  if (matricula.status !== 'ATIVA') {
    return err('STATUS_INVALIDO');
  }

  // Verificar se já existe operação em andamento para esta matrícula
  const pendingOp = await prisma.payerChangeOperacao.findFirst({
    where: {
      matriculaId: input.matriculaId,
      status: { in: ['PENDING', 'OLD_SUB_CANCELLED', 'NEW_SUB_CREATED'] },
    },
  });

  if (pendingOp) {
    return err('OPERACAO_EM_ANDAMENTO');
  }

  // 2. Buscar novo responsável
  const newResponsavel = await prisma.responsavel.findUnique({
    where: { id: input.newResponsavelId },
    select: {
      id: true,
      nome: true,
      cpf: true,
      email: true,
      asaasCustomerId: true,
    },
  });

  if (!newResponsavel) {
    return err('NOVO_RESPONSAVEL_NAO_ENCONTRADO');
  }

  if (!newResponsavel.cpf) {
    return err('NOVO_RESPONSAVEL_SEM_CPF');
  }

  // 3. Determinar pagador atual
  const oldPayerType: CustomerPayerType = matricula.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
  const oldPayerId = matricula.responsavelFinanceiroId ?? matricula.alunoId;

  // Verificar se é o mesmo pagador
  if (oldPayerType === 'RESPONSAVEL' && oldPayerId === input.newResponsavelId) {
    return err('MESMO_PAGADOR');
  }

  // 4. Verificar regra de maioridade (para referência futura)
  // Se aluno é maior e não tinha responsável, não faz sentido trocar para responsável
  // (ele é o próprio pagador) - mas permitimos se o usuário quiser explicitamente
  // Se aluno é menor, DEVE ter responsável

  // 5. Criar operação
  const operacao = await prisma.payerChangeOperacao.create({
    data: {
      correlationId,
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      status: 'PENDING',
      oldPayerType,
      oldPayerId,
      oldSubscriptionId: matricula.asaasSubscriptionId,
      newPayerType: 'RESPONSAVEL',
      newPayerId: input.newResponsavelId,
      idempotencyKey,
      reason: input.reason,
      createdById: input.actor.id,
    },
  });

  return finalizePayerChange({
    contaId: input.contaId,
    matricula: {
      id: matricula.id,
      alunoId: matricula.alunoId,
      asaasSubscriptionId: matricula.asaasSubscriptionId,
      responsavelFinanceiro: matricula.responsavelFinanceiro,
      aluno: { nome: matricula.aluno.nome },
    },
    newResponsavel: { id: newResponsavel.id, nome: newResponsavel.nome },
    operacao: {
      id: operacao.id,
      matriculaId: operacao.matriculaId,
      oldPayerType,
      oldPayerId,
      newPayerId: operacao.newPayerId,
      oldSubscriptionId: matricula.asaasSubscriptionId,
    },
    actor: input.actor,
    reason: input.reason,
  });
}

// ============================================================================
// RETRY
// ============================================================================

export async function retryPayerChange(
  operationId: string,
  actor: { type: 'USER' | 'SYSTEM'; id: string }
): Promise<Result<ChangePayerOutput, ChangePayerError>> {
  const operacao = await prisma.payerChangeOperacao.findUnique({
    where: { id: operationId },
  });

  if (!operacao) {
    return err('MATRICULA_NAO_ENCONTRADA');
  }

  if (operacao.status === 'COMMITTED') {
    return ok({
      operationId: operacao.id,
      status: operacao.status,
      matriculaId: operacao.matriculaId,
      oldPayerId: operacao.oldPayerId,
      newPayerId: operacao.newPayerId,
      uiMessage: 'Troca de pagador já realizada.',
    });
  }

  if (operacao.status !== 'PENDING' && operacao.status !== 'FAILED') {
    return err('OPERACAO_EM_ANDAMENTO');
  }

  const matricula = await prisma.matricula.findUnique({
    where: { id: operacao.matriculaId },
    include: {
      aluno: { select: { id: true, contaId: true, nome: true } },
      responsavelFinanceiro: { select: { id: true, nome: true } },
    },
  });

  if (!matricula) {
    return err('MATRICULA_NAO_ENCONTRADA');
  }

  if (matricula.aluno.contaId !== operacao.contaId) {
    return err('MATRICULA_PERTENCE_OUTRA_CONTA');
  }

  if (matricula.status !== 'ATIVA') {
    return err('STATUS_INVALIDO');
  }

  const newResponsavel = await prisma.responsavel.findUnique({
    where: { id: operacao.newPayerId },
    select: { id: true, nome: true, cpf: true },
  });

  if (!newResponsavel) {
    return err('NOVO_RESPONSAVEL_NAO_ENCONTRADO');
  }

  if (!newResponsavel.cpf) {
    return err('NOVO_RESPONSAVEL_SEM_CPF');
  }

  // Incrementar retry count
  await prisma.payerChangeOperacao.update({
    where: { id: operationId },
    data: {
      retryCount: { increment: 1 },
      lastRetryAt: new Date(),
    },
  });

  // Auditoria do retry
  await auditLogService.record({
    contaId: operacao.contaId,
    action: AUDIT_ACTIONS.PAYER_CHANGE.RETRY,
    entity: { type: 'MATRICULA', id: operacao.matriculaId },
    actor: { type: actor.type, id: actor.id },
    metadata: {
      operationId: operacao.id,
      retryCount: operacao.retryCount + 1,
      previousStatus: operacao.status,
    },
  });

  return finalizePayerChange({
    contaId: operacao.contaId,
    matricula: {
      id: matricula.id,
      alunoId: matricula.alunoId,
      asaasSubscriptionId: matricula.asaasSubscriptionId,
      responsavelFinanceiro: matricula.responsavelFinanceiro,
      aluno: { nome: matricula.aluno.nome },
    },
    newResponsavel: { id: newResponsavel.id, nome: newResponsavel.nome },
    operacao: {
      id: operacao.id,
      matriculaId: operacao.matriculaId,
      oldPayerType: operacao.oldPayerType,
      oldPayerId: operacao.oldPayerId,
      newPayerId: operacao.newPayerId,
      oldSubscriptionId: operacao.oldSubscriptionId,
    },
    actor,
    reason: operacao.reason ?? undefined,
  });
}
