import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function listPortalEvents(input: { contaId: string; alunoIds: string[] }) {
  return prisma.portalEvento.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['ATIVO', 'ENCERRADO'] },
    },
    select: {
      id: true,
      nome: true,
      descricao: true,
      dataInicio: true,
      dataFim: true,
      local: true,
      tipo: true,
      capacidade: true,
      status: true,
      inscricoes: {
        where: { alunoId: { in: input.alunoIds } },
        select: {
          id: true,
          status: true,
          quantidade: true,
          valorTotal: true,
          qrCode: true,
        },
        take: 1,
      },
    },
    orderBy: { dataInicio: 'desc' },
    take: 50,
  });
}

export async function findPortalResponsibleWithStudents(input: { userId: string; contaId: string }) {
  return prisma.responsavel.findFirst({
    where: {
      usuarioId: input.userId,
      contaId: input.contaId,
    },
    include: {
      alunos: {
        include: {
          aluno: {
            select: {
              id: true,
              nome: true,
              foto: true,
              dataNasc: true,
            },
          },
        },
      },
    },
  });
}

export function listPortalAcademicCobrancas(input: { contaId: string; alunoIds: string[] }) {
  return prisma.cobranca.findMany({
    where: {
      contaId: input.contaId,
      matricula: { alunoId: { in: input.alunoIds }, aluno: { contaId: input.contaId } },
    },
    include: {
      matricula: {
        include: {
          aluno: { select: { nome: true } },
          turma: { select: { nome: true, modalidade: { select: { nome: true } } } },
          responsavelFinanceiro: {
            select: { creditCardBrand: true, creditCardLast4: true },
          },
        },
      },
      pagamentos: {
        select: { id: true, dataPagamento: true, valorPago: true, status: true },
        orderBy: { dataPagamento: 'desc' },
        take: 1,
      },
    },
    orderBy: { vencimento: 'desc' },
  });
}

export function findPortalAcademicCobranca(input: {
  contaId: string;
  alunoIds: string[];
  cobrancaId: string;
}) {
  return prisma.cobranca.findFirst({
    where: {
      id: input.cobrancaId,
      contaId: input.contaId,
      matricula: { alunoId: { in: input.alunoIds }, aluno: { contaId: input.contaId } },
    },
    include: {
      matricula: {
        include: {
          aluno: {
            select: { id: true, usuarioId: true, nome: true, cpf: true, email: true, telefone: true },
          },
          turma: { include: { modalidade: { select: { nome: true } } } },
          responsavelFinanceiro: {
            select: {
              id: true,
              creditCardBrand: true,
              creditCardLast4: true,
              creditCardExpiryMonth: true,
              creditCardExpiryYear: true,
            },
          },
        },
      },
      pagamentos: { orderBy: { dataPagamento: 'desc' } },
    },
  });
}

export function findPortalStandaloneCharge(input: {
  contaId: string;
  chargeId: string;
  ownershipWhere: Prisma.ChargeWhereInput;
}) {
  return prisma.charge.findFirst({
    where: {
      id: input.chargeId,
      contaId: input.contaId,
      cobrancaId: null,
      ...input.ownershipWhere,
    },
    select: {
      id: true,
      status: true,
      value: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
      statusUpdatedAt: true,
      billingType: true,
      asaasPaymentId: true,
      asaasStatus: true,
      liquidacaoStatus: true,
      invoiceUrl: true,
      bankSlipUrl: true,
      bankSlipCancelledAt: true,
      identificationField: true,
      barCode: true,
      nossoNumero: true,
      payerName: true,
      description: true,
    },
  });
}

export async function findPortalPaymentId(input: {
  contaId: string;
  alunoIds: string[];
  responsavelId?: string | null;
  chargeId: string;
}) {
  const academic = await prisma.cobranca.findFirst({
    where: {
      id: input.chargeId,
      contaId: input.contaId,
      matricula: { alunoId: { in: input.alunoIds }, aluno: { contaId: input.contaId } },
    },
    select: { asaasPaymentId: true },
  });
  if (academic?.asaasPaymentId) return academic.asaasPaymentId;

  const { resolvePortalScopedPayerIds, buildPortalStandaloneChargeOwnershipWhere } = await import(
    '@/features/portal/finance-standalone'
  );
  const payerScope = await resolvePortalScopedPayerIds(input.contaId, input.alunoIds, input.responsavelId);
  const charge = await findPortalStandaloneCharge({
    contaId: input.contaId,
    chargeId: input.chargeId,
    ownershipWhere: buildPortalStandaloneChargeOwnershipWhere(payerScope),
  });
  return charge?.asaasPaymentId ?? null;
}

export function listPortalMatriculas(input: { contaId: string; alunoIds: string[] }) {
  return prisma.matricula.findMany({
    where: { contaId: input.contaId, alunoId: { in: input.alunoIds } },
    include: {
      aluno: { select: { nome: true, foto: true } },
      turma: {
        select: {
          nome: true,
          diasSemana: true,
          horaInicio: true,
          horaFim: true,
          modalidade: { select: { nome: true } },
        },
      },
      matriculaTurmas: {
        include: {
          turma: {
            select: {
              nome: true,
              diasSemana: true,
              horaInicio: true,
              horaFim: true,
              modalidade: { select: { nome: true } },
            },
          },
        },
      },
      plano: { select: { nome: true, valor: true, periodicidade: true } },
      cobrancas: {
        where: { OR: [{ status: 'PENDENTE' }, { status: 'ATRASADO' }] },
        select: { id: true, status: true, valor: true },
      },
    },
    orderBy: { dataInicio: 'desc' },
  });
}

export async function getPortalNotificationData(input: { contaId: string; alunoIds: string[] }) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const daqui30Dias = new Date(hoje);
  daqui30Dias.setDate(daqui30Dias.getDate() + 30);

  const [cobrancas, proximosEventos] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        contaId: input.contaId,
        matricula: { alunoId: { in: input.alunoIds }, contaId: input.contaId },
        OR: [{ status: 'PENDENTE' }, { status: 'ATRASADO' }],
      },
      select: { id: true, status: true, vencimento: true },
    }),
    prisma.portalEvento.findMany({
      where: {
        contaId: input.contaId,
        status: 'ATIVO',
        dataInicio: { gte: hoje, lte: daqui30Dias },
        inscricoes: {
          some: { alunoId: { in: input.alunoIds }, status: 'CONFIRMADA' },
        },
      },
      select: { id: true },
    }),
  ]);

  return { cobrancas, proximosEventos, hoje };
}
