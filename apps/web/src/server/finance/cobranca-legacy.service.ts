import { prisma } from '@/lib/prisma';
import { calculateCobrancaDynamicStatus } from '@alusa/finance';
import type { Prisma } from '@prisma/client';
import type {
  CreateLegacyCobrancaInputDTO,
  ListLegacyCobrancasQueryDTO,
} from '@/features/financeiro/cobrancas/dtos';

type ListLegacyCobrancasInput = {
  contaId: string;
  query: ListLegacyCobrancasQueryDTO;
};

type CreateLegacyCobrancaInput = {
  contaId: string;
  userId: string;
  userName?: string | null;
  input: CreateLegacyCobrancaInputDTO;
};

export async function listLegacyCobrancas(input: ListLegacyCobrancasInput) {
  const { contaId, query } = input;
  const { matriculaId, status, tipo, dataInicio, dataFim, limit, offset } = query;

  const where: Prisma.CobrancaWhereInput = {
    matricula: { aluno: { contaId } },
  };

  if (matriculaId) where.matriculaId = matriculaId;
  if (status) where.status = status;
  if (tipo) where.tipo = tipo;
  if (dataInicio || dataFim) {
    where.vencimento = {
      ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
      ...(dataFim ? { lte: new Date(dataFim) } : {}),
    };
  }

  const [cobrancas, total] = await Promise.all([
    prisma.cobranca.findMany({
      where,
      include: {
        matricula: {
          include: {
            aluno: {
              select: {
                id: true,
                nome: true,
                email: true,
                telefone: true,
                foto: true,
              },
            },
            plano: {
              select: {
                id: true,
                nome: true,
                valor: true,
              },
            },
            turma: {
              select: {
                id: true,
                nome: true,
              },
            },
          },
        },
        pagamentos: {
          orderBy: { dataPagamento: 'desc' },
          take: 1,
        },
      },
      orderBy: { vencimento: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.cobranca.count({ where }),
  ]);

  const data = cobrancas.map((cobranca) => ({
    ...cobranca,
    statusCalculado: calculateCobrancaDynamicStatus(cobranca.status, cobranca.vencimento),
    diasAteVencimento: Math.floor(
      (cobranca.vencimento.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    ),
    isPago: cobranca.status === 'PAGO',
    isEstornado: ['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(cobranca.status),
    isCancelado: cobranca.status === 'CANCELADO',
    podeReenviar: ['PENDENTE', 'ATRASADO', 'A_VENCER'].includes(cobranca.status),
  }));

  return {
    data,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

export async function createLegacyCobranca(input: CreateLegacyCobrancaInput) {
  const { contaId, userId, userName, input: data } = input;
  const matricula = await prisma.matricula.findFirst({
    where: { id: data.matriculaId, aluno: { contaId } },
    include: { aluno: true },
  });

  if (!matricula) return { ok: false as const, reason: 'MATRICULA_NOT_FOUND' as const };
  if (matricula.aluno.status !== 'ATIVO') {
    return { ok: false as const, reason: 'STUDENT_INACTIVE' as const };
  }

  const vencimento = new Date(data.vencimento);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  vencimento.setHours(0, 0, 0, 0);

  const status = vencimento > hoje ? 'A_VENCER' : vencimento < hoje ? 'ATRASADO' : 'PENDENTE';
  const cobranca = await prisma.cobranca.create({
    data: {
      contaId,
      matriculaId: data.matriculaId,
      tipo: data.tipo ?? 'MENSALIDADE',
      descricao: data.descricao,
      competenciaInicio: new Date(data.competenciaInicio),
      competenciaFim: new Date(data.competenciaFim),
      valor: data.valor,
      vencimento,
      formaPagamento: data.formaPagamento ?? 'BOLETO',
      status,
    },
    include: {
      matricula: {
        include: {
          aluno: { select: { id: true, nome: true, email: true } },
        },
      },
    },
  });

  await prisma.logFinanceiro.create({
    data: {
      contaId: matricula.aluno.contaId,
      usuarioId: userId,
      cobrancaId: cobranca.id,
      acao: 'CRIAR_COBRANCA_MANUAL',
      detalhes: {
        valor: data.valor,
        vencimento: String(data.vencimento),
        tipo: data.tipo,
        descricao: data.descricao,
        criadoPor: userName,
      },
    },
  });

  return { ok: true as const, data: cobranca };
}
