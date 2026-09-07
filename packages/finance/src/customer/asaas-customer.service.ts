import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

/**
 * Serviço para gestão segura de customers Asaas.
 * Regras críticas:
 * 1. Apenas responsáveis financeiros são customers no Asaas
 * 2. Customer pode ser compartilhado (responsável de múltiplos alunos)
 * 3. Inativação só ocorre se customer não é compartilhado
 */

export type CustomerInactivationResult = {
  canInactivate: boolean;
  reason: 'SAFE_TO_INACTIVATE' | 'SHARED_WITH_ACTIVE_ALUNOS' | 'NO_CUSTOMER_ID' | 'SHARED_WITH_ACTIVE_MATRICULAS';
  sharedWith?: {
    alunos: number;
    matriculas: number;
    subscriptions: number;
  };
};

/**
 * Verifica se um customer pode ser inativado no Asaas.
 * 
 * Regras:
 * - Customer pode ser compartilhado entre múltiplos alunos (ex.: pai de 3 filhos)
 * - Só inativar se não houver outros alunos/matrículas ativos usando o mesmo customer
 */
export async function canInactivateCustomer(params: {
  asaasCustomerId: string;
  contaId: string;
  excludeAlunoId?: string; // Excluir este aluno da contagem (o que está sendo arquivado)
}): Promise<CustomerInactivationResult> {
  const { asaasCustomerId, contaId, excludeAlunoId } = params;

  if (!asaasCustomerId) {
    return { canInactivate: false, reason: 'NO_CUSTOMER_ID' };
  }

  // The remote customer is a financial identity. Include every educational
  // alias from CustomerPayer, while keeping the tenant on both sides of the
  // lookup. Direct entity fields remain a compatibility fallback for legacy
  // rows that predate CustomerPayer.
  const identity = await prisma.customer.findFirst({
    where: { contaId, asaasCustomerId },
    select: {
      payerType: true,
      payerId: true,
      payerLinks: {
        where: { contaId },
        select: { payerType: true, payerId: true },
      },
    },
  });
  const identityAlunoIds = new Set<string>();
  const identityResponsavelIds = new Set<string>();
  if (identity) {
    (identity.payerType === 'ALUNO' ? identityAlunoIds : identityResponsavelIds).add(identity.payerId);
    for (const link of identity.payerLinks) {
      (link.payerType === 'ALUNO' ? identityAlunoIds : identityResponsavelIds).add(link.payerId);
    }
  }
  const alunoIdentityWhere: Prisma.AlunoWhereInput[] = [
    { asaasCustomerId },
    ...(identityAlunoIds.size ? [{ id: { in: [...identityAlunoIds] } }] : []),
  ];
  const responsavelIdentityWhere: Prisma.ResponsavelWhereInput[] = [
    { asaasCustomerId },
    ...(identityResponsavelIds.size ? [{ id: { in: [...identityResponsavelIds] } }] : []),
  ];

  // Buscar alunos ativos que usam este customer (diretamente ou via responsável)
  const [alunosWithSameCustomer, responsaveisWithSameCustomer] = await Promise.all([
    // Alunos maiores de idade que têm este asaasCustomerId
    prisma.aluno.count({
      where: {
        contaId,
        OR: alunoIdentityWhere,
        status: 'ATIVO',
        ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
      },
    }),
    // Responsáveis com este asaasCustomerId
    prisma.responsavel.count({
      where: {
        contaId,
        OR: responsavelIdentityWhere,
        alunos: {
          some: {
            aluno: {
              contaId,
              status: 'ATIVO',
              ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
            },
          },
        },
      },
    }),
  ]);

  const totalActiveAlunos = alunosWithSameCustomer + responsaveisWithSameCustomer;

  if (totalActiveAlunos > 0) {
    // Buscar mais detalhes para auditoria
    const [activeMatriculas, activeSubscriptions] = await Promise.all([
      prisma.matricula.count({
        where: {
          contaId,
          status: { in: ['ATIVA', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'PENDENTE_TAXA'] },
          aluno: {
            contaId,
            status: 'ATIVO',
            ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
              OR: [
              ...alunoIdentityWhere,
              {
                responsaveis: {
                  some: {
                    responsavel: { contaId, OR: responsavelIdentityWhere },
                  },
                },
              },
            ],
          },
        },
      }),
      prisma.subscription.count({
        where: {
          contaId,
          status: 'ACTIVE',
          matricula: {
            aluno: {
              contaId,
              status: 'ATIVO',
              ...(excludeAlunoId ? { id: { not: excludeAlunoId } } : {}),
              OR: [
                ...alunoIdentityWhere,
                {
                  responsaveis: {
                    some: {
                      responsavel: { contaId, OR: responsavelIdentityWhere },
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    ]);

    return {
      canInactivate: false,
      reason: activeMatriculas > 0 ? 'SHARED_WITH_ACTIVE_MATRICULAS' : 'SHARED_WITH_ACTIVE_ALUNOS',
      sharedWith: {
        alunos: totalActiveAlunos,
        matriculas: activeMatriculas,
        subscriptions: activeSubscriptions,
      },
    };
  }

  return { canInactivate: true, reason: 'SAFE_TO_INACTIVATE' };
}

export type SafeInactivationResult = {
  success: boolean;
  action: 'INACTIVATED' | 'SKIPPED' | 'ERROR';
  reason: CustomerInactivationResult['reason'] | 'INACTIVATION_FAILED';
  error?: string;
};

/**
 * Tenta inativar customer no Asaas apenas se for seguro.
 * Se o customer é compartilhado, apenas registra auditoria e não inativa.
 */
export async function inactivateCustomerIfSafe(params: {
  asaasCustomerId: string;
  contaId: string;
  alunoId: string;
  deleteCustomerFn: (customerId: string) => Promise<void>;
}): Promise<SafeInactivationResult> {
  const { asaasCustomerId, contaId, alunoId, deleteCustomerFn } = params;

  const checkResult = await canInactivateCustomer({
    asaasCustomerId,
    contaId,
    excludeAlunoId: alunoId,
  });

  if (!checkResult.canInactivate) {
    console.info('[AsaasCustomer] Inativação ignorada - customer compartilhado:', {
      asaasCustomerId,
      contaId,
      alunoId,
      reason: checkResult.reason,
      sharedWith: checkResult.sharedWith,
    });

    return {
      success: true,
      action: 'SKIPPED',
      reason: checkResult.reason,
    };
  }

  try {
    await deleteCustomerFn(asaasCustomerId);

    console.log('[AsaasCustomer] Customer inativado com sucesso:', {
      asaasCustomerId,
      contaId,
      alunoId,
    });

    return {
      success: true,
      action: 'INACTIVATED',
      reason: 'SAFE_TO_INACTIVATE',
    };
  } catch (error) {
    console.error('[AsaasCustomer] Falha ao inativar customer:', error);

    return {
      success: false,
      action: 'ERROR',
      reason: 'INACTIVATION_FAILED',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
