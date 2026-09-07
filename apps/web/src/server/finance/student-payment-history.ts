import { prisma } from '@/lib/prisma';
import { buildPersonPaymentLedger } from '@/src/server/finance/person-payment-ledger';
import {
  buildCategorySummary,
  inferStandaloneChargeType,
  normalizePaymentHistoryCategory,
  resolvePaymentHistoryDetailHref,
  resolveStandalonePaymentHistoryTipo,
  type PaymentHistoryCategory,
} from '@alusa/finance';
import {
  HISTORICAL_ASAAS_PAYMENT_STATUSES,
  reconcileAcademicCharges,
  resolveAcademicDisplayedStatus,
  resolveAcademicHistoricalPayment,
} from '@/src/server/finance/academic-payment-history';
import { buildAcademicAsaasData, mapBillingTypeToFormaPagamento } from '@/src/server/finance/asaas-payment-detail-policy';
import { resolveChargeDisplayStatus, type ChargeDisplayStatus } from '@alusa/finance';

type HistoricoPagamento = {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  comprovante: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
};

export type HistoricoCobrancaItem = {
  id: string;
  sourceKind:
    | 'cobranca'
    | 'charge'
    | 'sale'
    | 'event_ticket_sale'
    | 'event_participant_fee'
    | 'event_financial_entry'
    | 'event_map_order';
  sourceId: string;
  chargeType: string;
  origin: string;
  tipo: string | null;
  category: PaymentHistoryCategory;
  description: string | null;
  payerName: string;
  payerRole: 'ALUNO' | 'RESPONSAVEL';
  valor: number;
  vencimento: string | null;
  billingType: string | null;
  status: string;
  asaasStatus: string | null;
  liquidacaoStatus: string | null;
  displayStatus: ChargeDisplayStatus;
  asaasPaymentId: string | null;
  matriculaId: string | null;
  groupId: string | null;
  familyGroupId: string | null;
  isGroup: boolean;
  installmentCount: number | null;
  installmentsPaid: number | null;
  installmentLabel: string | null;
  planName: string | null;
  eventId?: string | null;
  externalReference?: string | null;
  originType?: string | null;
  detailHref: string;
  createdAt: string;
  pagamento: HistoricoPagamento | null;
};

type StudentPaymentScope = {
  matriculaIds: string[];
  responsavelFinanceiroIds: string[];
  familyGroupIds: string[];
  matriculaPlanNames: Map<string, string>;
  responsavelNames: Map<string, string>;
};

function dedupeKey(item: Pick<HistoricoCobrancaItem, 'sourceKind' | 'sourceId'>) {
  return `${item.sourceKind}:${item.sourceId}`;
}

function resolveStandaloneChargeType(charge: {
  standaloneInstallmentPlanId: string | null;
  standaloneSubscriptionId: string | null;
  externalReference: string;
}) {
  return inferStandaloneChargeType(charge);
}

function parseInstallmentFromDescription(description: string | null | undefined) {
  if (!description) return null;
  const match = description.match(/Parcela\s+(\d+)\/(\d+)/i);
  if (!match) return null;
  return {
    current: Number(match[1]),
    total: Number(match[2]),
    label: `Parcela ${match[1]}/${match[2]}`,
  };
}

function resolvePlanName(params: {
  matriculaId: string | null;
  matriculaPlanNames: Map<string, string>;
  description: string | null;
}) {
  if (params.matriculaId) {
    const planName = params.matriculaPlanNames.get(params.matriculaId);
    if (planName) return planName;
  }

  if (!params.description) return null;
  const cleaned = params.description.replace(/^Parcela\s+\d+\/\d+\s*-\s*/i, '').trim();
  return cleaned || null;
}

function resolvePayerRole(params: {
  payerType?: 'ALUNO' | 'RESPONSAVEL' | string | null;
}): 'ALUNO' | 'RESPONSAVEL' {
  return params.payerType === 'RESPONSAVEL' ? 'RESPONSAVEL' : 'ALUNO';
}

function buildHistoricoItem(
  base: Omit<HistoricoCobrancaItem, 'category' | 'detailHref'>,
): HistoricoCobrancaItem {
  const category = normalizePaymentHistoryCategory({
    tipo: base.tipo,
    chargeType: base.chargeType,
    origin: base.origin,
    sourceKind: base.sourceKind,
    description: base.description,
    familyGroupId: base.familyGroupId,
    externalReference: base.externalReference ?? null,
    originType: base.originType ?? null,
    eventId: base.eventId ?? null,
    hasSale: base.origin === 'LOJA' && base.sourceKind !== 'sale' ? true : undefined,
  });
  return {
    ...base,
    category,
    detailHref: resolvePaymentHistoryDetailHref({
      sourceKind: base.sourceKind,
      sourceId: base.sourceId,
      category,
      eventId: base.eventId ?? null,
    }),
  };
}

async function resolveStudentPaymentScope(contaId: string, alunoId: string): Promise<StudentPaymentScope> {
  const matriculas = await prisma.matricula.findMany({
    where: { alunoId, aluno: { contaId } },
    select: {
      id: true,
      responsavelFinanceiroId: true,
      matriculaFamiliarId: true,
      plano: { select: { nome: true } },
      combo: { select: { nome: true } },
      responsavelFinanceiro: { select: { id: true, nome: true } },
    },
  });

  const matriculaIds = matriculas.map((matricula) => matricula.id);
  const responsavelFinanceiroIds = [
    ...new Set(
      matriculas
        .map((matricula) => matricula.responsavelFinanceiroId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const familyGroupIds = new Set(
    matriculas
      .map((matricula) => matricula.matriculaFamiliarId)
      .filter((value): value is string => Boolean(value)),
  );

  if (matriculaIds.length > 0) {
    const familiarItems = await prisma.matriculaFamiliarItem.findMany({
      where: {
        matriculaId: { in: matriculaIds },
        matriculaFamiliar: { contaId },
      },
      select: { matriculaFamiliarId: true },
    });
    for (const item of familiarItems) {
      familyGroupIds.add(item.matriculaFamiliarId);
    }
  }

  const matriculaPlanNames = new Map<string, string>();
  const responsavelNames = new Map<string, string>();

  for (const matricula of matriculas) {
    const planName = matricula.combo?.nome ?? matricula.plano?.nome ?? null;
    if (planName) matriculaPlanNames.set(matricula.id, planName);
    if (matricula.responsavelFinanceiro) {
      responsavelNames.set(
        matricula.responsavelFinanceiro.id,
        matricula.responsavelFinanceiro.nome,
      );
    }
  }

  return {
    matriculaIds,
    responsavelFinanceiroIds,
    familyGroupIds: [...familyGroupIds],
    matriculaPlanNames,
    responsavelNames,
  };
}

function chargeBelongsToStudent(params: {
  charge: {
    payerType: string | null;
    payerId: string | null;
    familyGroupId: string | null;
    standaloneInstallmentPlan?: {
      payerType: string | null;
      payerId: string | null;
      familyGroupId: string | null;
    } | null;
    standaloneSubscription?: {
      payerType: string | null;
      payerId: string | null;
      familyGroupId: string | null;
    } | null;
    sale?: {
      alunoId: string | null;
      matriculaId: string | null;
      responsavelId: string | null;
    } | null;
  };
  alunoId: string;
  scope: StudentPaymentScope;
}) {
  const { charge, alunoId, scope } = params;

  if (charge.payerType === 'ALUNO' && charge.payerId === alunoId) {
    return true;
  }

  if (charge.sale?.alunoId === alunoId) return true;
  if (charge.sale?.matriculaId && scope.matriculaIds.includes(charge.sale.matriculaId)) return true;

  const familyGroupId =
    charge.familyGroupId ??
    charge.standaloneSubscription?.familyGroupId ??
    charge.standaloneInstallmentPlan?.familyGroupId;
  if (familyGroupId && scope.familyGroupIds.includes(familyGroupId)) return true;

  const payerType =
    charge.payerType ??
    charge.standaloneSubscription?.payerType ??
    charge.standaloneInstallmentPlan?.payerType;
  const payerId =
    charge.payerId ??
    charge.standaloneSubscription?.payerId ??
    charge.standaloneInstallmentPlan?.payerId;

  if (payerType === 'ALUNO' && payerId === alunoId) return true;

  return false;
}

async function loadAcademicCobrancas(
  contaId: string,
  alunoId: string,
  options?: { reconcile?: boolean },
) {
  async function query() {
    return prisma.cobranca.findMany({
      where: {
        matricula: {
          alunoId,
          aluno: { contaId },
        },
        OR: [
          { pagamentos: { some: {} } },
          { dataPagamento: { not: null } },
          { pagoEm: { not: null } },
          { status: { in: ['PAGO', 'ESTORNADO'] } },
          { asaasStatus: { in: [...HISTORICAL_ASAAS_PAYMENT_STATUSES] } },
        ],
      },
      select: {
        id: true,
        tipo: true,
        descricao: true,
        valor: true,
        vencimento: true,
        dataPagamento: true,
        formaPagamento: true,
        status: true,
        pagoEm: true,
        pagoPor: true,
        asaasPaymentId: true,
        asaasStatus: true,
        asaasValue: true,
        asaasNetValue: true,
        liquidacaoStatus: true,
        lastAsaasFetchAt: true,
        matriculaId: true,
        createdAt: true,
        pagamentos: {
          orderBy: [{ dataPagamento: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            id: true,
            status: true,
            valorPago: true,
            dataPagamento: true,
            formaPagamento: true,
            comprovante: true,
            asaasPaymentId: true,
            createdAt: true,
          },
        },
        matricula: {
          select: {
            plano: { select: { nome: true } },
            combo: { select: { nome: true } },
            responsavelFinanceiro: { select: { id: true, nome: true } },
          },
        },
        charge: {
          select: {
            id: true,
            externalReference: true,
            familyGroupId: true,
            payerType: true,
            payerId: true,
            standaloneInstallmentPlanId: true,
            standaloneSubscriptionId: true,
          },
        },
      },
      orderBy: [{ vencimento: 'desc' }, { createdAt: 'desc' }],
    });
  }

  let cobrancas = await query();
  if (options?.reconcile === true) {
    const reconciliation = await reconcileAcademicCharges({
      contaId,
      cobrancas,
      limit: 100,
    });
    if (reconciliation.attempted > 0) {
      cobrancas = await query();
    }
  }

  return cobrancas;
}

async function enrichInstallmentMetadata(contaId: string, items: HistoricoCobrancaItem[]) {
  const standalonePlanIds = [
    ...new Set(
      items
        .map((item) => item.groupId)
        .filter((groupId): groupId is string => Boolean(groupId))
        .filter((groupId) => items.some((item) => item.groupId === groupId && item.chargeType === 'INSTALLMENT')),
    ),
  ];

  const academicMatriculaIds = [
    ...new Set(
      items
        .filter((item) => item.sourceKind === 'cobranca' && item.tipo === 'PARCELADA' && item.matriculaId)
        .map((item) => item.matriculaId as string),
    ),
  ];

  const [standalonePlans, academicPlans, standalonePaidCounts, academicPaidCounts] = await Promise.all([
    standalonePlanIds.length
      ? prisma.standaloneInstallmentPlan.findMany({
          where: { contaId, id: { in: standalonePlanIds } },
          select: { id: true, installmentCount: true },
        })
      : Promise.resolve([]),
    academicMatriculaIds.length
      ? prisma.installmentPlan.findMany({
          where: { contaId, matriculaId: { in: academicMatriculaIds } },
          select: { id: true, matriculaId: true, installmentCount: true },
        })
      : Promise.resolve([]),
    standalonePlanIds.length
      ? prisma.charge.groupBy({
          by: ['standaloneInstallmentPlanId'],
          where: {
            contaId,
            standaloneInstallmentPlanId: { in: standalonePlanIds },
            status: 'PAID',
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    academicMatriculaIds.length
      ? prisma.cobranca.groupBy({
          by: ['matriculaId'],
          where: {
            contaId,
            matriculaId: { in: academicMatriculaIds },
            tipo: 'PARCELADA',
            OR: [
              { status: 'PAGO' },
              { pagamentos: { some: {} } },
              { dataPagamento: { not: null } },
            ],
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const standalonePlanById = new Map(standalonePlans.map((plan) => [plan.id, plan]));
  const academicPlanByMatriculaId = new Map(academicPlans.map((plan) => [plan.matriculaId, plan]));
  const standalonePaidByPlanId = new Map(
    standalonePaidCounts.map((entry) => [entry.standaloneInstallmentPlanId, entry._count._all]),
  );
  const academicPaidByMatriculaId = new Map(
    academicPaidCounts.map((entry) => [entry.matriculaId, entry._count._all]),
  );

  return items.map((item) => {
    if (item.category !== 'PARCELAMENTO') return item;

    const parsed = parseInstallmentFromDescription(item.description);
    let installmentCount = item.installmentCount;
    let installmentsPaid = item.installmentsPaid;
    let installmentLabel = item.installmentLabel;
    let groupId = item.groupId;

    if (item.chargeType === 'INSTALLMENT' && item.groupId) {
      const plan = standalonePlanById.get(item.groupId);
      if (plan) {
        installmentCount = plan.installmentCount;
        installmentsPaid = standalonePaidByPlanId.get(item.groupId) ?? installmentsPaid;
        groupId = plan.id;
      }
    }

    if (item.sourceKind === 'cobranca' && item.matriculaId) {
      const plan = academicPlanByMatriculaId.get(item.matriculaId);
      if (plan) {
        installmentCount = plan.installmentCount;
        installmentsPaid = academicPaidByMatriculaId.get(item.matriculaId) ?? installmentsPaid;
        groupId = plan.id;
      }
    }

    if (parsed) {
      installmentCount = installmentCount ?? parsed.total;
      installmentLabel = parsed.label;
    }

    return {
      ...item,
      groupId,
      installmentCount,
      installmentsPaid,
      installmentLabel,
      isGroup: Boolean(groupId),
    };
  });
}

export type GetStudentPaymentHistoryOptions = {
  /** Leitura de histórico na UI — evita N chamadas ao Asaas por request. */
  reconcile?: boolean;
};

export async function getStudentPaymentHistory(
  contaId: string,
  alunoId: string,
  alunoNome: string,
  options?: GetStudentPaymentHistoryOptions,
) {
  if (options?.reconcile !== true) {
    const ledger = await buildPersonPaymentLedger({
      contaId,
      personType: 'ALUNO',
      personId: alunoId,
    });

    if (ledger) {
      return {
        cobrancas: ledger.cobrancas,
        resumo: ledger.resumo,
      };
    }
  }

  const scope = await resolveStudentPaymentScope(contaId, alunoId);
  const cobrancasAcademicas = await loadAcademicCobrancas(contaId, alunoId, options);

  const items: HistoricoCobrancaItem[] = [];
  const seen = new Set<string>();

  for (const cobranca of cobrancasAcademicas) {
    const pagamentoHistorico = resolveAcademicHistoricalPayment(cobranca);
    if (!pagamentoHistorico) continue;

    const asaasData = buildAcademicAsaasData(cobranca as unknown as Record<string, unknown>);
    const obligationPayerType =
      cobranca.charge?.payerType ??
      (cobranca.matricula?.responsavelFinanceiro?.id ? 'RESPONSAVEL' : 'ALUNO');
    const obligationPayerId =
      cobranca.charge?.payerId ??
      (obligationPayerType === 'RESPONSAVEL'
        ? cobranca.matricula?.responsavelFinanceiro?.id ?? null
        : alunoId);
    const payerName =
      obligationPayerType === 'RESPONSAVEL'
        ? scope.responsavelNames.get(obligationPayerId ?? '') ??
          (cobranca.matricula?.responsavelFinanceiro?.id === obligationPayerId
            ? cobranca.matricula.responsavelFinanceiro.nome
            : alunoNome)
        : alunoNome;
    const parsedInstallment = parseInstallmentFromDescription(cobranca.descricao);
    const groupId =
      cobranca.charge?.standaloneInstallmentPlanId ??
      cobranca.charge?.standaloneSubscriptionId ??
      cobranca.charge?.familyGroupId ??
      null;

    const item = buildHistoricoItem({
      id: cobranca.id,
      sourceKind: 'cobranca',
      sourceId: cobranca.id,
      chargeType: cobranca.tipo,
      origin: 'ACADEMICO',
      tipo: cobranca.tipo,
      description: cobranca.descricao,
      payerName,
      payerRole: resolvePayerRole({
        payerType: obligationPayerType,
      }),
      valor: Number(cobranca.valor),
      vencimento: cobranca.vencimento.toISOString(),
      billingType:
        mapBillingTypeToFormaPagamento(asaasData?.billingType) ?? cobranca.formaPagamento,
      status: resolveAcademicDisplayedStatus({
        localCobrancaStatus: cobranca.status,
        remotePaymentStatus: cobranca.asaasStatus ?? null,
        dueDate: cobranca.vencimento,
      }),
      asaasStatus: cobranca.asaasStatus,
      liquidacaoStatus: cobranca.liquidacaoStatus,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: cobranca.status,
        asaasStatus: cobranca.asaasStatus,
        liquidacaoStatus: cobranca.liquidacaoStatus,
        hasAsaasLink: Boolean(cobranca.asaasPaymentId),
      }),
      asaasPaymentId: cobranca.asaasPaymentId,
      matriculaId: cobranca.matriculaId,
      groupId,
      familyGroupId: cobranca.charge?.familyGroupId ?? null,
      isGroup: Boolean(groupId),
      installmentCount: parsedInstallment?.total ?? null,
      installmentsPaid: null,
      installmentLabel: parsedInstallment?.label ?? null,
      planName: resolvePlanName({
        matriculaId: cobranca.matriculaId,
        matriculaPlanNames: scope.matriculaPlanNames,
        description: cobranca.descricao,
      }),
      createdAt: cobranca.createdAt.toISOString(),
      pagamento: {
        id: pagamentoHistorico.id,
        status: pagamentoHistorico.status,
        valorPago: pagamentoHistorico.valorPago,
        dataPagamento: pagamentoHistorico.dataPagamento,
        formaPagamento: pagamentoHistorico.formaPagamento,
        comprovante: pagamentoHistorico.comprovante,
        asaasPaymentId: pagamentoHistorico.asaasPaymentId,
        createdAt: pagamentoHistorico.createdAt,
      },
    });

    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const standaloneChargeCandidates = await prisma.charge.findMany({
    where: {
      contaId,
      cobrancaId: null,
      status: 'PAID',
      OR: [
        { payerType: 'ALUNO', payerId: alunoId },
        { sale: { contaId, alunoId } },
        ...(scope.matriculaIds.length
          ? [{ sale: { contaId, matriculaId: { in: scope.matriculaIds } } }]
          : []),
        ...(scope.familyGroupIds.length ? [{ familyGroupId: { in: scope.familyGroupIds } }] : []),
        ...(scope.familyGroupIds.length
          ? [
              {
                standaloneSubscription: {
                  contaId,
                  familyGroupId: { in: scope.familyGroupIds },
                },
              },
              {
                standaloneInstallmentPlan: {
                  contaId,
                  familyGroupId: { in: scope.familyGroupIds },
                },
              },
            ]
          : []),
        {
          standaloneSubscription: { contaId, payerType: 'ALUNO', payerId: alunoId },
        },
        {
          standaloneInstallmentPlan: { contaId, payerType: 'ALUNO', payerId: alunoId },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      externalReference: true,
      asaasPaymentId: true,
      asaasStatus: true,
      liquidacaoStatus: true,
      value: true,
      dueDate: true,
      billingType: true,
      payerName: true,
      description: true,
      standaloneInstallmentPlanId: true,
      standaloneSubscriptionId: true,
      invoiceUrl: true,
      statusUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
      customerId: true,
      payerType: true,
      payerId: true,
      familyGroupId: true,
      standaloneInstallmentPlan: {
        select: { id: true, installmentCount: true, payerType: true, payerId: true, familyGroupId: true },
      },
      standaloneSubscription: {
        select: { id: true, description: true, payerType: true, payerId: true, familyGroupId: true },
      },
      sale: {
        select: {
          id: true,
          alunoId: true,
          matriculaId: true,
          responsavelId: true,
          saleNumber: true,
          total: true,
          paymentMethod: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
  });

  for (const charge of standaloneChargeCandidates) {
    if (!chargeBelongsToStudent({ charge, alunoId, scope })) continue;

    const chargeType = resolveStandaloneChargeType(charge);
    const sourceDescription = charge.sale
      ? `Loja #${String(charge.sale.saleNumber).padStart(4, '0')}`
      : charge.description;
    const tipo = resolveStandalonePaymentHistoryTipo({
      chargeType,
      hasSale: Boolean(charge.sale),
      familyGroupId: charge.familyGroupId,
      description: sourceDescription,
      externalReference: charge.externalReference,
    });
    const value = Number(charge.value ?? charge.sale?.total ?? 0);
    const paidAt = (charge.statusUpdatedAt ?? charge.updatedAt ?? charge.createdAt).toISOString();
    const obligationPayerType =
      charge.payerType ??
      charge.standaloneSubscription?.payerType ??
      charge.standaloneInstallmentPlan?.payerType;
    const obligationPayerId =
      charge.payerId ??
      charge.standaloneSubscription?.payerId ??
      charge.standaloneInstallmentPlan?.payerId;
    const payerName =
      (obligationPayerType === 'RESPONSAVEL'
        ? scope.responsavelNames.get(obligationPayerId ?? '')
        : obligationPayerType === 'ALUNO' && obligationPayerId === alunoId
          ? alunoNome
          : null) ??
      charge.payerName ??
      alunoNome;
    const groupId =
      charge.standaloneInstallmentPlanId ??
      charge.standaloneSubscriptionId ??
      charge.familyGroupId ??
      null;
    const parsedInstallment = parseInstallmentFromDescription(sourceDescription);

    const item = buildHistoricoItem({
      id: charge.id,
      sourceKind: 'charge',
      sourceId: charge.id,
      chargeType,
      origin: charge.sale ? 'LOJA' : 'STANDALONE',
      tipo,
      description:
        sourceDescription ??
        (chargeType === 'SUBSCRIPTION'
          ? charge.standaloneSubscription?.description ?? 'Assinatura recorrente'
          : chargeType === 'INSTALLMENT'
            ? 'Parcela'
            : 'Cobrança avulsa'),
      payerName,
      payerRole: resolvePayerRole({
        payerType: obligationPayerType,
      }),
      valor: value,
      vencimento: charge.dueDate?.toISOString() ?? charge.createdAt.toISOString(),
      billingType: charge.sale?.paymentMethod ?? charge.billingType,
      status: 'PAGO',
      asaasStatus: charge.asaasStatus,
      liquidacaoStatus: charge.liquidacaoStatus,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: charge.status,
        asaasStatus: charge.asaasStatus,
        liquidacaoStatus: charge.liquidacaoStatus,
        hasAsaasLink: Boolean(charge.asaasPaymentId),
      }),
      asaasPaymentId: charge.asaasPaymentId,
      matriculaId: charge.sale?.matriculaId ?? null,
      groupId,
      familyGroupId: charge.familyGroupId,
      isGroup: Boolean(groupId),
      installmentCount: charge.standaloneInstallmentPlan?.installmentCount ?? parsedInstallment?.total ?? null,
      installmentsPaid: null,
      installmentLabel: parsedInstallment?.label ?? null,
      planName:
        charge.standaloneSubscription?.description ??
        resolvePlanName({
          matriculaId: charge.sale?.matriculaId ?? null,
          matriculaPlanNames: scope.matriculaPlanNames,
          description: sourceDescription,
        }),
      eventId: null,
      externalReference: charge.externalReference,
      createdAt: charge.createdAt.toISOString(),
      pagamento: {
        id: charge.id,
        status: 'PAID',
        valorPago: value,
        dataPagamento: paidAt,
        formaPagamento: charge.sale?.paymentMethod ?? charge.billingType ?? 'INDEFINIDO',
        comprovante: charge.invoiceUrl,
        asaasPaymentId: charge.asaasPaymentId,
        createdAt: paidAt,
      },
    });

    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const directStoreSales = await prisma.sale.findMany({
    where: {
      contaId,
      status: 'CONCLUIDA',
      finalizationType: 'RECEBIMENTO_PRESENCIAL',
      chargeId: null,
      OR: [
        { alunoId },
        ...(scope.matriculaIds.length ? [{ matriculaId: { in: scope.matriculaIds } }] : []),
        ...(scope.responsavelFinanceiroIds.length
          ? [
              {
                responsavelId: { in: scope.responsavelFinanceiroIds },
                OR: [{ alunoId }, ...(scope.matriculaIds.length ? [{ matriculaId: { in: scope.matriculaIds } }] : [])],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      saleNumber: true,
      total: true,
      paymentMethod: true,
      alunoId: true,
      matriculaId: true,
      responsavelId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const sale of directStoreSales) {
    const paidAt = sale.updatedAt?.toISOString() ?? sale.createdAt.toISOString();
    const value = Number(sale.total);
    const payerName =
      sale.responsavelId && scope.responsavelNames.has(sale.responsavelId)
        ? scope.responsavelNames.get(sale.responsavelId)!
        : alunoNome;

    const item = buildHistoricoItem({
      id: sale.id,
      sourceKind: 'sale',
      sourceId: sale.id,
      chargeType: 'ONE_TIME',
      origin: 'LOJA',
      tipo: 'LOJA',
      description: `Loja #${String(sale.saleNumber).padStart(4, '0')}`,
      payerName,
      payerRole: resolvePayerRole({
        payerType: sale.responsavelId ? 'RESPONSAVEL' : 'ALUNO',
      }),
      valor: value,
      vencimento: sale.createdAt.toISOString(),
      billingType: sale.paymentMethod,
      status: 'PAGO',
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({ localStatus: 'PAGO' }),
      asaasPaymentId: null,
      matriculaId: sale.matriculaId,
      groupId: null,
      familyGroupId: null,
      isGroup: false,
      installmentCount: null,
      installmentsPaid: null,
      installmentLabel: null,
      planName: null,
      createdAt: sale.createdAt.toISOString(),
      pagamento: {
        id: sale.id,
        status: 'PAGO',
        valorPago: value,
        dataPagamento: paidAt,
        formaPagamento: sale.paymentMethod ?? 'INDEFINIDO',
        comprovante: null,
        asaasPaymentId: null,
        createdAt: paidAt,
      },
    });

    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  const enrichedItems = await enrichInstallmentMetadata(contaId, items);

  enrichedItems.sort((left, right) => {
    const leftDate = left.vencimento ?? left.createdAt;
    const rightDate = right.vencimento ?? right.createdAt;
    return new Date(rightDate).getTime() - new Date(leftDate).getTime();
  });

  const totalPago = enrichedItems.reduce(
    (sum, item) => sum + (item.pagamento ? item.pagamento.valorPago : 0),
    0,
  );

  return {
    cobrancas: enrichedItems,
    resumo: {
      total: enrichedItems.length,
      totalPago,
      totalValor: totalPago,
      porCategoria: buildCategorySummary(enrichedItems),
    },
  };
}
