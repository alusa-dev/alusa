import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { validarElegibilidadeRematricula } from '@alusa/domain';
import {
  buildFinancialSnapshot,
  evaluateCanonicalRematriculaDecision,
} from '@/src/server/matriculas/rematricula-financial-policy.service';
import { resolveResponsavelRouteId } from '../../_lib/resolve-responsavel-route-id';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function mapEventChargeStatus(status: string) {
  switch (status) {
    case 'PAID':
    case 'RECEIVED':
    case 'COMPLIMENTARY':
    case 'CONFIRMED':
      return 'PAGO';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELADO';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'ESTORNADO';
    case 'EXPECTED':
    case 'PENDING':
    case 'PAYMENT_PENDING':
    default:
      return 'PENDENTE';
  }
}

async function loadRematriculaDecision(params: {
  contaId: string;
  matriculaId: string;
}) {
  const matricula = await prisma.matricula.findFirst({
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
  });

  if (!matricula) return null;

  const diasRestantes = Math.ceil(
    (matricula.dataFimContrato.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
  const contratoExpirado = diasRestantes < 0;
  const academicEligible = validarElegibilidadeRematricula({
    status: matricula.status,
    contratoExpirado,
    diasContratoExpirado: contratoExpirado ? Math.abs(diasRestantes) : 0,
  }).success;

  const financialSnapshot = buildFinancialSnapshot({
    cobrancas: matricula.cobrancas,
    statusFinanceiro: matricula.statusFinanceiro,
    integrationStatus: matricula.integrationStatus,
    debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
  });

  const decision = evaluateCanonicalRematriculaDecision({
    academicEligible,
    financialSnapshot,
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
    const responsavelId = await resolveResponsavelRouteId(id, user.contaId);
    if (!responsavelId) {
      return NextResponse.json({ error: { message: 'Responsável não encontrado.' } }, { status: 404 });
    }

    const responsavel = await prisma.responsavel.findFirst({
      where: { id: responsavelId, contaId: user.contaId },
      select: { id: true, nome: true },
    });

    if (!responsavel) {
      return NextResponse.json({ error: { message: 'Responsável não encontrado.' } }, { status: 404 });
    }

    const [families, reenrollments, customerIds, alunosVinculados] = await Promise.all([
      prisma.matriculaFamiliar.findMany({
        where: { contaId: user.contaId, responsavelId },
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
        where: { contaId: user.contaId, responsavelId },
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
          payerId: responsavelId,
        },
        select: { id: true },
      }),
      prisma.aluno.findMany({
        where: {
          contaId: user.contaId,
          responsaveis: {
            some: { responsavelId },
          },
        },
        select: {
          id: true,
          nome: true,
          matriculas: {
            orderBy: { dataFimContrato: 'asc' },
            select: {
              id: true,
              status: true,
              statusFinanceiro: true,
              statusContrato: true,
              dataInicio: true,
              dataFimContrato: true,
              createdAt: true,
              plano: { select: { nome: true } },
              combo: { select: { nome: true } },
              turma: { select: { nome: true } },
              matriculaTurmas: {
                select: { turma: { select: { nome: true } } },
                take: 3,
              },
              rematriculaItensOrigem: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  decision: true,
                  status: true,
                  matriculaFuturaId: true,
                  effectiveAt: true,
                  targetPeriodId: true,
                  processo: { select: { id: true, status: true, origin: true, effectiveAt: true } },
                },
              },
              rematriculaItensFuturos: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  decision: true,
                  status: true,
                  matriculaOrigemId: true,
                  effectiveAt: true,
                  targetPeriodId: true,
                  processo: { select: { id: true, status: true, origin: true, effectiveAt: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const familyIds = [
      ...families.map((family) => family.id),
      ...reenrollments.map((family) => family.id),
    ];

    const scopedCustomerIds = customerIds.map((customer) => customer.id);
    const chargeOr = [
      ...(scopedCustomerIds.length > 0 ? [{ customerId: { in: scopedCustomerIds } }] : []),
      ...(familyIds.length > 0 ? [{ familyGroupId: { in: familyIds } }] : []),
    ];

    const [charges, standaloneSubscriptions, academicSubscriptions, standaloneInstallmentPlans] = await Promise.all([
      prisma.charge.findMany({
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
          billingType: true,
          invoiceUrl: true,
          familyGroupId: true,
          standaloneSubscriptionId: true,
          standaloneInstallmentPlanId: true,
          createdAt: true,
        },
      }),
      prisma.standaloneSubscription.findMany({
        where: {
          contaId: user.contaId,
          ...(chargeOr.length > 0
            ? {
                OR: [
                  ...(scopedCustomerIds.length > 0 ? [{ customerId: { in: scopedCustomerIds } }] : []),
                  ...(familyIds.length > 0 ? [{ familyGroupId: { in: familyIds } }] : []),
                ],
              }
            : { id: '__none__' }),
        },
        orderBy: [{ nextDueDate: 'asc' }, { createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          status: true,
          asaasSubscriptionId: true,
          externalReference: true,
          cycle: true,
          billingType: true,
          value: true,
          nextDueDate: true,
          description: true,
          familyGroupId: true,
          createdAt: true,
        },
      }),
      prisma.subscription.findMany({
        where: {
          contaId: user.contaId,
          OR: [
            { matricula: { responsavelFinanceiroId: responsavelId } },
            {
              billingAgreement: {
                payerType: 'RESPONSAVEL',
                payerId: responsavelId,
              },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          asaasSubscriptionId: true,
          externalReference: true,
          createdAt: true,
          matricula: {
            select: {
              plano: { select: { nome: true } },
              combo: { select: { nome: true } },
            },
          },
          billingAgreement: {
            select: {
              cycle: true,
              billingType: true,
              confirmedValue: true,
              desiredValue: true,
              nextDueDate: true,
            },
          },
        },
      }),
      prisma.standaloneInstallmentPlan.findMany({
        where: {
          contaId: user.contaId,
          ...(chargeOr.length > 0
            ? {
                OR: [
                  ...(scopedCustomerIds.length > 0 ? [{ customerId: { in: scopedCustomerIds } }] : []),
                  ...(familyIds.length > 0 ? [{ familyGroupId: { in: familyIds } }] : []),
                ],
              }
            : { id: '__none__' }),
        },
        orderBy: [{ firstDueDate: 'asc' }, { createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          status: true,
          asaasInstallmentId: true,
          externalReference: true,
          installmentCount: true,
          billingType: true,
          value: true,
          firstDueDate: true,
          familyGroupId: true,
          createdAt: true,
        },
      }),
    ]);

    const [eventParticipants, eventTicketSales] = await Promise.all([
      prisma.eventParticipant.findMany({
        where: {
          contaId: user.contaId,
          responsavelId,
          revenueEntryId: { not: null },
        },
        select: { revenueEntryId: true },
      }),
      prisma.eventTicketSale.findMany({
        where: {
          contaId: user.contaId,
          responsavelId,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { event: { select: { name: true } } },
      }),
    ]);

    const eventRevenueEntryIds = [
      ...new Set(
        [
          ...eventParticipants.map((item) => item.revenueEntryId),
          ...eventTicketSales.map((sale) => sale.revenueEntryId),
        ].filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];

    const eventEntries = eventRevenueEntryIds.length
      ? await prisma.eventFinancialEntry.findMany({
          where: {
            contaId: user.contaId,
            id: { in: eventRevenueEntryIds },
          },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
          include: { event: { select: { name: true } } },
        })
      : [];

    const eventEntryById = new Map(eventEntries.map((entry) => [entry.id, entry]));
    const eventCharges = [
      ...eventEntries.map((entry) => ({
        id: `event-entry:${entry.id}`,
        origin: 'EVENT',
        description: `${entry.event.name} · ${entry.description}`,
        status: mapEventChargeStatus(entry.status),
        value: Number(entry.expectedAmount ?? 0),
        dueDate: entry.dueDate?.toISOString() ?? entry.realizedAt?.toISOString() ?? entry.createdAt.toISOString(),
        billingType: entry.paymentMethod,
        invoiceUrl: null,
        familyGroupId: null,
        standaloneSubscriptionId: null,
        standaloneInstallmentPlanId: null,
        createdAt: entry.createdAt.toISOString(),
      })),
      ...eventTicketSales
        .filter((sale) => !sale.revenueEntryId || !eventEntryById.has(sale.revenueEntryId))
        .map((sale) => ({
          id: `event-ticket-sale:${sale.id}`,
          origin: 'EVENT',
          description: `${sale.event.name} · ${sale.quantity} ingresso(s)`,
          status: mapEventChargeStatus(sale.status),
          value: Number(sale.totalAmount ?? 0),
          dueDate: sale.soldAt.toISOString(),
          billingType: sale.paymentMethod,
          invoiceUrl: null,
          familyGroupId: null,
          standaloneSubscriptionId: null,
          standaloneInstallmentPlanId: null,
          createdAt: sale.createdAt.toISOString(),
        })),
    ];

    const mappedCharges = charges.map((charge) => ({
      ...charge,
      origin: charge.familyGroupId ? 'FAMILY' : 'STANDALONE',
      value: Number(charge.value ?? 0),
      dueDate: charge.dueDate?.toISOString() ?? null,
      createdAt: charge.createdAt.toISOString(),
    }));
    const allCharges = [...mappedCharges, ...eventCharges];

    const openCharges = allCharges.filter((charge) =>
      ['CREATED', 'OPEN', 'OVERDUE', 'PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO'].includes(charge.status),
    );
    const overdueCharges = allCharges.filter((charge) => ['OVERDUE', 'ATRASADO'].includes(charge.status));

    const rematriculaCandidates = [];
    for (const aluno of alunosVinculados) {
      for (const matricula of aluno.matriculas.filter(
        (item) =>
          ['ATIVA', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'PENDENTE_TAXA'].includes(item.status) &&
          ['AGUARDANDO_ASSINATURA', 'ATIVO', 'EXPIRADO'].includes(item.statusContrato),
      )) {
        const decision = await loadRematriculaDecision({
          contaId: user.contaId,
          matriculaId: matricula.id,
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

    const enrollmentHistory = alunosVinculados.flatMap((aluno) =>
      aluno.matriculas.map((matricula) => {
        const futureLink = matricula.rematriculaItensFuturos[0] ?? null;
        const originLink = matricula.rematriculaItensOrigem[0] ?? null;
        const renewalLink = futureLink ?? originLink;
        return {
          id: matricula.id,
          alunoId: aluno.id,
          alunoNome: aluno.nome,
          kind: futureLink ? 'REMATRICULA' : 'MATRICULA',
          status: matricula.status,
          statusFinanceiro: matricula.statusFinanceiro,
          statusContrato: matricula.statusContrato,
          dataInicio: matricula.dataInicio.toISOString(),
          dataFimContrato: matricula.dataFimContrato.toISOString(),
          createdAt: matricula.createdAt.toISOString(),
          planoNome: matricula.plano?.nome ?? null,
          comboNome: matricula.combo?.nome ?? null,
          turmaNome:
            matricula.turma?.nome ??
            (matricula.matriculaTurmas.map((item) => item.turma.nome).join(', ') || null),
          rematricula: renewalLink
            ? {
                itemId: renewalLink.id,
                processoId: renewalLink.processo.id,
                processoStatus: renewalLink.processo.status,
                processoOrigem: renewalLink.processo.origin,
                decision: renewalLink.decision,
                itemStatus: renewalLink.status,
                effectiveAt: (
                  renewalLink.effectiveAt ?? renewalLink.processo.effectiveAt
                ).toISOString(),
                targetPeriodId: renewalLink.targetPeriodId,
                matriculaOrigemId: futureLink?.matriculaOrigemId ?? null,
                matriculaFuturaId: originLink?.matriculaFuturaId ?? null,
              }
            : null,
        };
      }),
    ).sort((a, b) => {
      const aTime = new Date(a.dataInicio ?? a.createdAt).getTime();
      const bTime = new Date(b.dataInicio ?? b.createdAt).getTime();
      return bTime - aTime;
    });

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
        charges: allCharges,
        subscriptions: [
          ...academicSubscriptions.map((subscription) => ({
            id: subscription.id,
            source: 'MATRICULA' as const,
            status: subscription.status,
            asaasSubscriptionId: subscription.asaasSubscriptionId,
            externalReference: subscription.externalReference,
            cycle: subscription.billingAgreement?.cycle ?? 'MONTHLY',
            billingType: subscription.billingAgreement?.billingType ?? 'UNKNOWN',
            value: Number(
              subscription.billingAgreement?.confirmedValue ??
                subscription.billingAgreement?.desiredValue ??
                0,
            ),
            nextDueDate: subscription.billingAgreement?.nextDueDate?.toISOString() ?? null,
            description:
              subscription.matricula.plano?.nome ??
              subscription.matricula.combo?.nome ??
              'Assinatura de matrícula',
            familyGroupId: null,
            createdAt: subscription.createdAt.toISOString(),
          })),
          ...standaloneSubscriptions.map((subscription) => ({
            ...subscription,
            source: 'AVULSA' as const,
            value: Number(subscription.value ?? 0),
            nextDueDate: subscription.nextDueDate.toISOString(),
            createdAt: subscription.createdAt.toISOString(),
          })),
        ].sort((a, b) => {
          const aTime = new Date(a.createdAt).getTime();
          const bTime = new Date(b.createdAt).getTime();
          return bTime - aTime;
        }),
        installmentPlans: standaloneInstallmentPlans.map((plan) => ({
          ...plan,
          source: 'AVULSO',
          value: Number(plan.value ?? 0),
          firstDueDate: plan.firstDueDate.toISOString(),
          createdAt: plan.createdAt.toISOString(),
        })),
        rematriculaCandidates,
        enrollmentHistory,
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
