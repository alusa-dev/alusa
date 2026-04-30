import { prisma } from '@alusa/database';

/**
 * Guards de Regra de Negócio para Cobranças
 * 
 * ADR: Proteções de Regra de Negócio
 * 
 * Objetivo: Impedir estados financeiros inválidos
 */

export type CreateChargeGuardInput = {
  contaId: string;
  matriculaId: string;
  payerType: 'ALUNO' | 'RESPONSAVEL';
  payerId: string;
  valor: number;
};

export type ChargeGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: ChargeGuardErrorCode };

export type ChargeGuardErrorCode =
  | 'PAYER_TYPE_UNDEFINED'
  | 'PAYER_ID_MISSING'
  | 'ASAAS_CUSTOMER_MISSING'
  | 'MATRICULA_NOT_FOUND'
  | 'MATRICULA_INATIVA'
  | 'CONTA_INVALIDA'
  | 'VALOR_INVALIDO'
  | 'SUBCONTA_NAO_CONFIGURADA';

/**
 * Verifica se pode criar cobrança
 * 
 * Bloqueia criação se:
 * - asaasCustomerId === null
 * - payer.type === undefined
 * - matricula não encontrada ou inativa
 * - conta não tem perfil financeiro configurado
 */
export async function canCreateCharge(
  input: CreateChargeGuardInput
): Promise<ChargeGuardResult> {
  // 1. Validar tipo de pagador
  if (!input.payerType) {
    return { allowed: false, reason: 'Tipo de pagador não definido', code: 'PAYER_TYPE_UNDEFINED' };
  }

  // 2. Validar ID do pagador
  if (!input.payerId) {
    return { allowed: false, reason: 'ID do pagador não informado', code: 'PAYER_ID_MISSING' };
  }

  // 3. Validar valor
  if (input.valor <= 0) {
    return { allowed: false, reason: 'Valor da cobrança deve ser maior que zero', code: 'VALOR_INVALIDO' };
  }

  // 4. Verificar matrícula
  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      status: true,
      responsavelFinanceiroId: true,
      aluno: {
        select: {
          id: true,
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
    return { allowed: false, reason: 'Matrícula não encontrada', code: 'MATRICULA_NOT_FOUND' };
  }

  if (matricula.aluno.contaId !== input.contaId) {
    return { allowed: false, reason: 'Conta inválida para esta matrícula', code: 'CONTA_INVALIDA' };
  }

  // 5. Verificar status da matrícula
  const statusesPermitidos = ['ATIVA', 'PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO'];
  if (!statusesPermitidos.includes(matricula.status)) {
    return {
      allowed: false,
      reason: `Matrícula com status ${matricula.status} não permite novas cobranças`,
      code: 'MATRICULA_INATIVA',
    };
  }

  // 6. Verificar asaasCustomerId do pagador
  const asaasCustomerId = input.payerType === 'ALUNO'
    ? matricula.aluno.asaasCustomerId
    : matricula.responsavelFinanceiro?.asaasCustomerId;

  if (!asaasCustomerId) {
    return {
      allowed: false,
      reason: 'Pagador não possui customer ID no Asaas. Execute ensureCustomer primeiro.',
      code: 'ASAAS_CUSTOMER_MISSING',
    };
  }

  // 7. Verificar se conta tem perfil financeiro
  const financeProfile = await prisma.financeProfile.findUnique({
    where: { contaId: input.contaId },
    select: { id: true, isOnboardingCompleted: true },
  });

  if (!financeProfile) {
    return {
      allowed: false,
      reason: 'Conta não possui perfil financeiro configurado',
      code: 'SUBCONTA_NAO_CONFIGURADA',
    };
  }

  return { allowed: true };
}

/**
 * Guard para edição de dados sensíveis pós-cobrança
 * 
 * ADR: Segurança Operacional
 * 
 * Bloqueia edição de:
 * - CPF
 * - asaasCustomerId
 * Após qualquer cobrança emitida
 */
export type EditGuardInput = {
  contaId: string;
  entityType: 'ALUNO' | 'RESPONSAVEL';
  entityId: string;
  fieldsToEdit: string[];
};

export type EditGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string; blockedFields: string[] };

const BLOCKED_FIELDS_AFTER_CHARGE = ['cpf', 'asaasCustomerId', 'asaasId'];

export async function canEditEntity(
  input: EditGuardInput
): Promise<EditGuardResult> {
  const blockedFields = input.fieldsToEdit.filter((f) =>
    BLOCKED_FIELDS_AFTER_CHARGE.includes(f.toLowerCase())
  );

  if (blockedFields.length === 0) {
    return { allowed: true };
  }

  // Verificar se existe cobrança para este pagador
  let hasCharges = false;

  if (input.entityType === 'ALUNO') {
    const count = await prisma.cobranca.count({
      where: {
        matricula: {
          alunoId: input.entityId,
          aluno: { contaId: input.contaId },
          responsavelFinanceiroId: null, // Aluno é o pagador direto
        },
      },
    });
    hasCharges = count > 0;
  } else {
    const count = await prisma.cobranca.count({
      where: {
        matricula: {
          responsavelFinanceiroId: input.entityId,
          aluno: { contaId: input.contaId },
        },
      },
    });
    hasCharges = count > 0;
  }

  if (hasCharges) {
    return {
      allowed: false,
      reason: `Campos ${blockedFields.join(', ')} não podem ser editados após emissão de cobrança`,
      blockedFields,
    };
  }

  return { allowed: true };
}

export const chargeGuards = {
  canCreate: canCreateCharge,
  canEdit: canEditEntity,
};
