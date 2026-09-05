import { prisma } from '@alusa/database';
import { resolvePayer } from '@alusa/domain';
import type { PayerResolvedDTO } from '@alusa/domain';
import { ensureCustomer } from '../use-cases/ensure-customer';

/**
 * ResolvePayerService — Serviço único de resolução de pagador
 * 
 * ADR: Service Único de Resolução de Pagador
 * 
 * Objetivo: Eliminar lógica duplicada e divergente em todo o sistema.
 * Este serviço é usado obrigatoriamente por:
 * - Matrícula
 * - Cobrança avulsa
 * - Renegociação
 * - Assinatura
 * - Parcelamento
 */

export type ResolvePayerFromAlunoInput = {
  contaId: string;
  alunoId: string;
  /** Se não passado, busca do banco */
  alunoDataNasc?: Date;
  /** Se não passado, busca da matrícula ativa ou do aluno */
  responsavelFinanceiroId?: string | null;
};

export type ResolvePayerFromMatriculaInput = {
  contaId: string;
  matriculaId: string;
};

export type ResolvePayerOutput = 
  | { success: true; payer: PayerResolvedDTO }
  | { success: false; error: string; code: ResolvePayerErrorCode };

export type ResolvePayerErrorCode =
  | 'ALUNO_NAO_ENCONTRADO'
  | 'MATRICULA_NAO_ENCONTRADA'
  | 'RESPONSAVEL_OBRIGATORIO_MENOR'
  | 'ALUNO_SEM_ID'
  | 'CONTA_INVALIDA';

/**
 * Resolve o pagador a partir do ID do aluno
 */
export async function resolvePayerFromAluno(
  input: ResolvePayerFromAlunoInput
): Promise<ResolvePayerOutput> {
  // 1. Buscar aluno se necessário
  let alunoDataNasc = input.alunoDataNasc;
  let responsavelFinanceiroId = input.responsavelFinanceiroId;

  if (!alunoDataNasc || responsavelFinanceiroId === undefined) {
    const aluno = await prisma.aluno.findFirst({
      where: { id: input.alunoId, contaId: input.contaId },
      select: {
        id: true,
        dataNasc: true,
        asaasCustomerId: true,
        responsaveis: {
          where: {
            OR: [
              { responsavel: { financeiro: true } },
              { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
            ],
          },
          select: {
            responsavelId: true,
            responsavel: { select: { id: true, asaasCustomerId: true } },
          },
          take: 1,
        },
      },
    });

    if (!aluno) {
      return { success: false, error: 'Aluno não encontrado', code: 'ALUNO_NAO_ENCONTRADO' };
    }

    alunoDataNasc = aluno.dataNasc;
    if (responsavelFinanceiroId === undefined) {
      responsavelFinanceiroId = aluno.responsaveis[0]?.responsavelId ?? null;
    }
  }

  // 2. Aplicar regra de domínio
  const result = resolvePayer({
    alunoId: input.alunoId,
    alunoDataNasc,
    responsavelFinanceiroId,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error === 'RESPONSAVEL_OBRIGATORIO_MENOR'
        ? 'Responsável financeiro é obrigatório para aluno menor de idade'
        : 'ID do aluno inválido',
      code: result.error,
    };
  }

  // 3. Buscar asaasCustomerId
  const isMenor = result.payer.type === 'RESPONSAVEL';
  let asaasCustomerId: string | null = null;

  if (result.payer.type === 'ALUNO') {
    const aluno = await prisma.aluno.findFirst({
      where: { id: result.payer.id, contaId: input.contaId },
      select: { asaasCustomerId: true },
    });
    asaasCustomerId = aluno?.asaasCustomerId ?? null;
  } else {
    const responsavel = await prisma.responsavel.findFirst({
      where: { id: result.payer.id, contaId: input.contaId },
      select: { asaasCustomerId: true },
    });
    asaasCustomerId = responsavel?.asaasCustomerId ?? null;
  }

  return {
    success: true,
    payer: {
      payerType: result.payer.type,
      payerId: result.payer.id,
      asaasCustomerId,
      resolvedAt: new Date(),
      isMenor,
      needsResponsavel: isMenor,
    },
  };
}

/**
 * Resolve o pagador a partir do ID da matrícula
 */
export async function resolvePayerFromMatricula(
  input: ResolvePayerFromMatriculaInput
): Promise<ResolvePayerOutput> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      responsavelFinanceiroId: true,
      aluno: {
        select: {
          id: true,
          dataNasc: true,
          asaasCustomerId: true,
          contaId: true,
        },
      },
      responsavelFinanceiro: {
        select: {
          id: true,
          asaasCustomerId: true,
        },
      },
    },
  });

  if (!matricula) {
    return { success: false, error: 'Matrícula não encontrada', code: 'MATRICULA_NAO_ENCONTRADA' };
  }

  if (matricula.aluno.contaId !== input.contaId) {
    return { success: false, error: 'Conta inválida', code: 'CONTA_INVALIDA' };
  }

  // Aplicar regra de domínio
  const result = resolvePayer({
    alunoId: matricula.aluno.id,
    alunoDataNasc: matricula.aluno.dataNasc,
    responsavelFinanceiroId: matricula.responsavelFinanceiroId,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error === 'RESPONSAVEL_OBRIGATORIO_MENOR'
        ? 'Responsável financeiro é obrigatório para aluno menor de idade'
        : 'ID do aluno inválido',
      code: result.error,
    };
  }

  const isMenor = result.payer.type === 'RESPONSAVEL';
  const asaasCustomerId = result.payer.type === 'ALUNO'
    ? matricula.aluno.asaasCustomerId
    : matricula.responsavelFinanceiro?.asaasCustomerId ?? null;

  return {
    success: true,
    payer: {
      payerType: result.payer.type,
      payerId: result.payer.id,
      asaasCustomerId,
      resolvedAt: new Date(),
      isMenor,
      needsResponsavel: isMenor,
    },
  };
}

/**
 * Resolve o pagador E garante que existe customer no Asaas
 * 
 * Este é o método completo para uso em criação de cobranças/assinaturas
 */
export async function resolvePayerWithCustomer(
  input: ResolvePayerFromAlunoInput | ResolvePayerFromMatriculaInput
): Promise<
  | { success: true; payer: PayerResolvedDTO; asaasCustomerId: string }
  | { success: false; error: string; code: ResolvePayerErrorCode | 'ASAAS_ERRO' }
> {
  // 1. Resolver pagador
  const resolved = 'matriculaId' in input
    ? await resolvePayerFromMatricula(input)
    : await resolvePayerFromAluno(input);

  if (!resolved.success) {
    return resolved;
  }

  // 2. Se já tem asaasCustomerId, retornar
  if (resolved.payer.asaasCustomerId) {
    return {
      success: true,
      payer: resolved.payer,
      asaasCustomerId: resolved.payer.asaasCustomerId,
    };
  }

  // 3. Garantir customer no Asaas
  const contaId = input.contaId;
  const customerResult = await ensureCustomer({
    contaId,
    payer: {
      type: resolved.payer.payerType,
      id: resolved.payer.payerId,
    },
  });

  if (!customerResult.success) {
    return {
      success: false,
      error: `Erro ao criar customer no Asaas: ${customerResult.error}`,
      code: 'ASAAS_ERRO',
    };
  }

  return {
    success: true,
    payer: {
      ...resolved.payer,
      asaasCustomerId: customerResult.data.customerId,
    },
    asaasCustomerId: customerResult.data.customerId,
  };
}

export const resolvePayerService = {
  fromAluno: resolvePayerFromAluno,
  fromMatricula: resolvePayerFromMatricula,
  withCustomer: resolvePayerWithCustomer,
};
