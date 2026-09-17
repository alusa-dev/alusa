import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export const responsavelSummarySelect = {
  id: true,
  nome: true,
  cpf: true,
  email: true,
  telefone: true,
  financeiro: true,
  consentimentoComunicacoes: true,
  consentimentoMarketing: true,
  _count: { select: { alunos: true } },
} as const;

export async function listResponsaveisForTenant(input: {
  contaId: string;
  search?: string;
  cpfDigits?: string;
  status: 'TODOS' | 'ATIVO' | 'INATIVO';
  take: number;
}) {
  const where = {
    contaId: input.contaId,
    ...(input.status === 'ATIVO'
      ? {
          alunos: {
            some: {
              contaId: input.contaId,
              aluno: { contaId: input.contaId, status: 'ATIVO' as const },
            },
          },
        }
      : input.status === 'INATIVO'
        ? {
            alunos: {
              some: {
                contaId: input.contaId,
                aluno: { contaId: input.contaId, status: 'INATIVO' as const },
              },
              none: {
                contaId: input.contaId,
                aluno: { contaId: input.contaId, status: 'ATIVO' as const },
              },
            },
          }
        : {}),
    ...(input.search
      ? {
          OR: [
            { nome: { contains: input.search, mode: 'insensitive' as const } },
            ...(input.cpfDigits
              ? [{ cpf: { contains: input.cpfDigits, mode: 'insensitive' as const } }]
              : []),
          ],
        }
      : {}),
  };

  return prisma.responsavel.findMany({
    where,
    orderBy: { nome: 'asc' },
    take: input.take,
    select: responsavelSummarySelect,
  });
}

export async function findResponsavelByTenantIdentity(input: {
  contaId: string;
  cpf: string;
  email?: string;
}) {
  return prisma.responsavel.findFirst({
    where: {
      contaId: input.contaId,
      OR: [{ cpf: input.cpf }, ...(input.email ? [{ email: input.email }] : [])],
    },
    select: responsavelSummarySelect,
  });
}

export async function createResponsavelForTenant(input: {
  data: Prisma.ResponsavelUncheckedCreateInput;
  contaId: string;
  actorId: string;
  consentimentoComunicacoes: boolean;
  consentimentoMarketing: boolean;
}) {
  const responsavel = await prisma.responsavel.create({
    data: input.data,
    select: responsavelSummarySelect,
  });

  if (input.consentimentoComunicacoes || input.consentimentoMarketing) {
    await prisma.auditLog.create({
      data: {
        contaId: input.contaId,
        actorType: 'USER',
        actorId: input.actorId,
        action: 'COMUNICACAO_CONSENTIMENTO_ATUALIZADO',
        entityType: 'RESPONSAVEL',
        entityId: responsavel.id,
        metadata: {
          consentimentoComunicacoes: input.consentimentoComunicacoes,
          consentimentoMarketing: input.consentimentoMarketing,
          origem: 'RESPONSAVEL_CADASTRO',
          versao: '2026-09-05',
        },
      },
    });
  }

  return responsavel;
}
