import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  buildFinancialSnapshot,
  evaluateRematriculaDecision,
  getContaFinancialPolicy,
} from '@/src/server/matriculas/rematricula-financial-policy.service';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

async function loadRematriculaDecision(params: {
  contaId: string;
  matriculaId: string;
  currentUserRole?: string | null;
}) {
  const [policy, matricula] = await Promise.all([
    getContaFinancialPolicy(params.contaId),
    prisma.matricula.findFirst({
      where: { id: params.matriculaId, aluno: { contaId: params.contaId } },
      select: {
        id: true,
        status: true,
        dataFimContrato: true,
        integrationStatus: true,
        statusFinanceiro: true,
        cobrancas: {
          where: {
            status: {
              in: ['A_VENCER', 'PENDENTE', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'],
            },
          },
          select: { status: true },
        },
      },
    }),
  ]);

  if (!matricula) return null;

  const diasRestantes = Math.ceil(
    (matricula.dataFimContrato.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  const academicEligible = validarElegibilidadeRematricula({
    status: matricula.status,
    contratoExpirado: diasRestantes < 0,
  }).success;

  const financialSnapshot = buildFinancialSnapshot({
    cobrancas: matricula.cobrancas,
    statusFinanceiro: matricula.statusFinanceiro,
    integrationStatus: matricula.integrationStatus,
    debtScope: policy.debtScope,
  });

  const decision = evaluateRematriculaDecision({
    academicEligible,
    financialSnapshot,
    policy,
    currentUserRole: params.currentUserRole,
  });

  return { decision };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado.' } }, { status: 401 });
  }
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return NextResponse.json({ error: { message: 'Permissão negada.' } }, { status: 403 });
  }

  try {
    const { id } = await Promise.resolve(context.params);
    const responsavel = await prisma.responsavel.findFirst({
      where: { id, contaId: user.contaId },
      select: { id: true, nome: true },
    });

    if (!responsavel) {
      return NextResponse.json({ error: { message: 'Responsável não encontrado.' } }, { status: 404 });
    }

    const [families, reenrollments, customerIds, alunosVinculados] = await Promise.all([
      prisma.matriculaFamiliar.findMany({
        where: { contaId: user.contaId, responsavelId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          totalAlunos: true,
          valorMensalidadeTotal: true,
          valorTaxaMatriculaTotal: true,
          standaloneSubscriptionId: true,
          standaloneEnrollmentChargeId: true,
          createdAt: true,
        },
      }),
      prisma.rematriculaFamiliar.findMany({
        where: { contaId: user.contaId, responsavelId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          totalAlunos: true,
          valorMensalidadeTotal: true,
          valorTaxaMatriculaTotal: true,
          standaloneSubscriptionId: true,
          standaloneEnrollmentChargeId: true,
          createdAt: true,
        },
      }),
      prisma.customer.findMany({
        where: {
          contaId: user.contaId,
          payerType: 'RESPONSAVEL',
          payerId: id,
        },
        select: { id: true },
      }),
      prisma.aluno.findMany({
        where: {
          contaId: user.contaId,
          responsaveis: {
            some: { responsavelId: id },
          },
        },
        select: {
          id: true,
          nome: true,
          matriculas: {
            where: {
              status: { in: ['ATIVA', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'PENDENTE_TAXA'] },
              statusContrato: { in: ['AGUARDANDO_ASSINATURA', 'ATIVO', 'EXPIRADO'] },
            },
            orderBy: { dataFimContrato: 'asc' },
            select: {
              id: true,
              dataFimContrato: true,
              plano: { select: { nome: true } },
              combo: { select: { nome: true } },
              turma: { select: { nome: true } },
            },
          },
        },
      }),
    ]);

    const familyIds = [
      ...families.map((family) => family.id),
      ...reenrollments.map((family) => family.id),
    ];

    const chargeOr = [
      ...(customerIds.length > 0 ? [{ customerId: { in: customerIds.map((customer) => customer.id) } }] : []),
      ...(familyIds.length > 0 ? [{ familyGroupId: { in: familyIds } }] : []),
    ];

    const charges = await prisma.charge.findMany({
      where: {
        contaId: user.contaId,
        ...(chargeOr.length > 0 ? { OR: chargeOr } : { id: '__none__' }),
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        description: true,
        status: true,
        value: true,
        dueDate: true,
        invoiceUrl: true,
        familyGroupId: true,
      },
    });

    const openCharges = charges.filter((charge) => ['CREATED', 'OPEN', 'OVERDUE'].includes(charge.status));
    const overdueCharges = charges.filter((charge) => charge.status === 'OVERDUE');

    const rematriculaCandidates = [];
    for (const aluno of alunosVinculados) {
      for (const matricula of aluno.matriculas) {
        const decision = await loadRematriculaDecision({
          contaId: user.contaId,
          matriculaId: matricula.id,
          currentUserRole: user.role,
        });

        rematriculaCandidates.push({
          matriculaId: matricula.id,
          alunoId: aluno.id,
          alunoNome: aluno.nome,
          dataFimContrato: matricula.dataFimContrato.toISOString(),
          planoNome: matricula.plano?.nome ?? null,
          comboNome: matricula.combo?.nome ?? null,
          turmaNome: matricula.turma?.nome ?? null,
          actionStatus: decision?.decision.actionStatus ?? 'BLOQUEADA',
          blockReason: decision?.decision.blockReason ?? null,
          message: decision?.decision.message ?? 'Matrícula indisponível para rematrícula.',
          podeRenovar: decision
            ? decision.decision.actionStatus === 'LIBERADA' ||
              decision.decision.actionStatus === 'REQUER_OVERRIDE'
            : false,
        });
      }
    }

    return NextResponse.json(
      {
        summary: {
          familyEnrollments: families.length,
          familyReenrollments: reenrollments.length,
          openCharges: openCharges.length,
          overdueCharges: overdueCharges.length,
          totalOpenValue: Number(
            openCharges.reduce((acc, charge) => acc + Number(charge.value ?? 0), 0).toFixed(2),
          ),
        },
        families: families.map((family) => ({
          ...family,
          type: 'MATRICULA',
          valorMensalidadeTotal: Number(family.valorMensalidadeTotal),
          valorTaxaMatriculaTotal: Number(family.valorTaxaMatriculaTotal),
        })),
        reenrollments: reenrollments.map((family) => ({
          ...family,
          type: 'REMATRICULA',
          valorMensalidadeTotal: Number(family.valorMensalidadeTotal),
          valorTaxaMatriculaTotal: Number(family.valorTaxaMatriculaTotal),
        })),
        charges: charges.map((charge) => ({
          ...charge,
          value: Number(charge.value ?? 0),
          dueDate: charge.dueDate?.toISOString() ?? null,
        })),
        rematriculaCandidates,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[GET /api/responsaveis/[id]/overview]', error);
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Erro ao carregar visão 360.' } },
      { status: 500 },
    );
  }
}
