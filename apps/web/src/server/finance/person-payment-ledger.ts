import { prisma } from '@/lib/prisma';
import { isMenorDeIdade } from '@alusa/domain';
import {
  buildCategorySummary,
  inferStandaloneChargeType,
  mergeLedgerItemsByPriority,
  normalizePaymentHistoryCategory,
  resolvePaymentHistoryDetailHref,
  resolveStandalonePaymentHistoryTipo,
  setPaymentHistoryUnmappedLogger,
  shouldSkipStandaloneChargeInLedger,
  type PaymentHistoryCategory,
} from '@alusa/finance';

let paymentHistoryUnmappedLoggerConfigured = false;
if (!paymentHistoryUnmappedLoggerConfigured) {
  setPaymentHistoryUnmappedLogger((context) => {
    console.warn('[payment-history:unmapped]', {
      reason: context.reason,
      sourceKind: context.sourceKind,
      tipo: context.tipo,
      origin: context.origin,
      externalReference: context.externalReference,
      description: context.description,
    });
  });
  paymentHistoryUnmappedLoggerConfigured = true;
}
import {
  HISTORICAL_ASAAS_PAYMENT_STATUSES,
  resolveAcademicDisplayedStatus,
  resolveAcademicHistoricalPayment,
} from '@/src/server/finance/academic-payment-history';
import { buildAcademicAsaasData, mapBillingTypeToFormaPagamento } from '@/src/server/finance/asaas-payment-detail-policy';
import { resolveChargeDisplayStatus, type ChargeDisplayStatus } from '@alusa/finance';

export type PersonPaymentLedgerType = 'ALUNO' | 'RESPONSAVEL';
export type PersonPaymentSourceKind =
  | 'cobranca'
  | 'charge'
  | 'sale'
  | 'event_ticket_sale'
  | 'event_participant_fee'
  | 'event_financial_entry'
  | 'event_map_order';

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

export type PersonPaymentLedgerItem = {
  id: string;
  sourceKind: PersonPaymentSourceKind;
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
  eventId: string | null;
  externalReference?: string | null;
  originType?: string | null;
  detailHref: string;
  createdAt: string;
  pagamento: HistoricoPagamento | null;
};

export type PersonPaymentLedgerPerson = {
  id: string;
  tipo: PersonPaymentLedgerType;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  cpf: string | null;
  foto: string | null;
  alunosVinculados: Array<{ id: string; nome: string }>;
};

export type PersonPaymentLedgerResult = {
  pessoa: PersonPaymentLedgerPerson;
  cobrancas: PersonPaymentLedgerItem[];
  resumo: {
    total: number;
    totalPago: number;
    totalValor: number;
    porCategoria: Record<PaymentHistoryCategory, { count: number; totalPago: number }>;
  };
};

type LedgerScope = {
  pessoa: PersonPaymentLedgerPerson;
  alunoIds: string[];
  matriculaIds: string[];
  responsavelIds: string[];
  familyGroupIds: string[];
  customerIds: string[];
  matriculaPlanNames: Map<string, string>;
  responsavelNames: Map<string, string>;
  alunoNames: Map<string, string>;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
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

function buildLedgerItem(
  base: Omit<PersonPaymentLedgerItem, 'category' | 'detailHref'>,
): PersonPaymentLedgerItem {
  const category = normalizePaymentHistoryCategory({
    tipo: base.tipo,
    chargeType: base.chargeType,
    origin: base.origin,
    sourceKind: base.sourceKind,
    description: base.description,
    familyGroupId: base.familyGroupId,
    externalReference: base.externalReference ?? null,
    originType: base.originType ?? null,
    eventId: base.eventId,
    hasSale: base.origin === 'LOJA' && base.sourceKind !== 'sale' ? true : undefined,
  });
  return {
    ...base,
    category,
    detailHref: resolvePaymentHistoryDetailHref({
      sourceKind: base.sourceKind,
      sourceId: base.sourceId,
      category,
      eventId: base.eventId,
    }),
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
  personType?: PersonPaymentLedgerType;
  customerPayerType?: string | null;
  payerId?: string | null;
  responsavelIds: string[];
}) {
  if (params.customerPayerType === 'RESPONSAVEL') return 'RESPONSAVEL';
  if (params.personType === 'RESPONSAVEL') return 'RESPONSAVEL';
  if (params.payerId && params.responsavelIds.includes(params.payerId)) return 'RESPONSAVEL';
  return 'ALUNO';
}

async function resolveLedgerScope(params: {
  contaId: string;
  personType: PersonPaymentLedgerType;
  personId: string;
}): Promise<LedgerScope | null> {
  if (params.personType === 'ALUNO') {
    const aluno = await prisma.aluno.findFirst({
      where: { id: params.personId, contaId: params.contaId },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cpf: true,
        foto: true,
        responsaveis: {
          select: {
            responsavel: {
              select: { id: true, nome: true },
            },
          },
        },
      },
    });

    if (!aluno) return null;

    return buildScopeFromAlunoIds({
      contaId: params.contaId,
      pessoa: {
        id: aluno.id,
        tipo: 'ALUNO',
        nome: aluno.nome,
        email: aluno.email,
        telefone: aluno.telefone,
        cpf: aluno.cpf,
        foto: aluno.foto,
        alunosVinculados: [{ id: aluno.id, nome: aluno.nome }],
      },
      alunoIds: [aluno.id],
      extraResponsavelIds: aluno.responsaveis.map((item) => item.responsavel.id),
      extraResponsavelNames: aluno.responsaveis.map((item) => item.responsavel),
    });
  }

  const responsavel = await prisma.responsavel.findFirst({
    where: { id: params.personId, contaId: params.contaId },
    select: {
      id: true,
      nome: true,
      email: true,
      telefone: true,
      cpf: true,
      foto: true,
      alunos: {
        select: {
          aluno: {
            select: { id: true, nome: true },
          },
        },
      },
    },
  });

  if (!responsavel) return null;

  return buildScopeFromAlunoIds({
    contaId: params.contaId,
    pessoa: {
      id: responsavel.id,
      tipo: 'RESPONSAVEL',
      nome: responsavel.nome,
      email: responsavel.email,
      telefone: responsavel.telefone,
      cpf: responsavel.cpf,
      foto: responsavel.foto,
      alunosVinculados: responsavel.alunos.map((item) => item.aluno),
    },
    alunoIds: responsavel.alunos.map((item) => item.aluno.id),
    extraResponsavelIds: [responsavel.id],
    extraResponsavelNames: [{ id: responsavel.id, nome: responsavel.nome }],
  });
}

async function buildScopeFromAlunoIds(params: {
  contaId: string;
  pessoa: PersonPaymentLedgerPerson;
  alunoIds: string[];
  extraResponsavelIds: string[];
  extraResponsavelNames: Array<{ id: string; nome: string }>;
}): Promise<LedgerScope> {
  const matriculas = await prisma.matricula.findMany({
    where: {
      contaId: params.contaId,
      OR: [
        ...(params.alunoIds.length ? [{ alunoId: { in: params.alunoIds } }] : []),
        ...(params.extraResponsavelIds.length
          ? [{ responsavelFinanceiroId: { in: params.extraResponsavelIds } }]
          : []),
      ],
    },
    select: {
      id: true,
      alunoId: true,
      responsavelFinanceiroId: true,
      matriculaFamiliarId: true,
      plano: { select: { nome: true } },
      combo: { select: { nome: true } },
      aluno: { select: { id: true, nome: true } },
      responsavelFinanceiro: { select: { id: true, nome: true } },
    },
  });

  const alunoIds = new Set(params.alunoIds);
  const responsavelIds = new Set(params.extraResponsavelIds);
  const familyGroupIds = new Set<string>();
  const matriculaPlanNames = new Map<string, string>();
  const responsavelNames = new Map(params.extraResponsavelNames.map((item) => [item.id, item.nome]));
  const alunoNames = new Map(params.pessoa.alunosVinculados.map((item) => [item.id, item.nome]));

  for (const matricula of matriculas) {
    alunoIds.add(matricula.alunoId);
    alunoNames.set(matricula.aluno.id, matricula.aluno.nome);
    if (matricula.responsavelFinanceiroId) responsavelIds.add(matricula.responsavelFinanceiroId);
    if (matricula.matriculaFamiliarId) familyGroupIds.add(matricula.matriculaFamiliarId);
    const planName = matricula.combo?.nome ?? matricula.plano?.nome ?? null;
    if (planName) matriculaPlanNames.set(matricula.id, planName);
    if (matricula.responsavelFinanceiro) {
      responsavelNames.set(matricula.responsavelFinanceiro.id, matricula.responsavelFinanceiro.nome);
    }
  }

  if (matriculas.length > 0) {
    const familiarItems = await prisma.matriculaFamiliarItem.findMany({
      where: { matriculaId: { in: matriculas.map((matricula) => matricula.id) } },
      select: { matriculaFamiliarId: true },
    });
    for (const item of familiarItems) {
      familyGroupIds.add(item.matriculaFamiliarId);
    }
  }

  const customers = await prisma.customer.findMany({
    where: {
      contaId: params.contaId,
      OR: [
        ...(alunoIds.size ? [{ payerType: 'ALUNO' as const, payerId: { in: [...alunoIds] } }] : []),
        ...(responsavelIds.size
          ? [{ payerType: 'RESPONSAVEL' as const, payerId: { in: [...responsavelIds] } }]
          : []),
      ],
    },
    select: { id: true },
  });

  return {
    pessoa: {
      ...params.pessoa,
      alunosVinculados: [...alunoNames].map(([id, nome]) => ({ id, nome })),
    },
    alunoIds: [...alunoIds],
    matriculaIds: matriculas.map((matricula) => matricula.id),
    responsavelIds: [...responsavelIds],
    familyGroupIds: [...familyGroupIds],
    customerIds: customers.map((customer) => customer.id),
    matriculaPlanNames,
    responsavelNames,
    alunoNames,
  };
}

async function loadAcademicItems(contaId: string, scope: LedgerScope): Promise<PersonPaymentLedgerItem[]> {
  if (scope.matriculaIds.length === 0) return [];

  const cobrancas = await prisma.cobranca.findMany({
    where: {
      matriculaId: { in: scope.matriculaIds },
      matricula: { contaId },
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
          aluno: { select: { id: true, nome: true } },
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
          standaloneInstallmentPlanId: true,
          standaloneSubscriptionId: true,
        },
      },
    },
    orderBy: [{ vencimento: 'desc' }, { createdAt: 'desc' }],
  });

  return cobrancas.map((cobranca) => {
    const pagamentoHistorico = resolveAcademicHistoricalPayment(cobranca);
    const asaasData = buildAcademicAsaasData(cobranca as unknown as Record<string, unknown>);
    const payerName =
      cobranca.matricula?.responsavelFinanceiro?.nome ??
      cobranca.matricula?.aluno?.nome ??
      scope.pessoa.nome;
    const parsedInstallment = parseInstallmentFromDescription(cobranca.descricao);
    const groupId =
      cobranca.charge?.standaloneInstallmentPlanId ??
      cobranca.charge?.standaloneSubscriptionId ??
      cobranca.charge?.familyGroupId ??
      null;

    return buildLedgerItem({
      id: cobranca.id,
      sourceKind: 'cobranca',
      sourceId: cobranca.id,
      chargeType: cobranca.tipo,
      origin: 'ACADEMICO',
      tipo: cobranca.tipo,
      description: cobranca.descricao,
      payerName,
      payerRole: resolvePayerRole({
        personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
        payerId: cobranca.matricula?.responsavelFinanceiro?.id ?? null,
        responsavelIds: scope.responsavelIds,
      }),
      valor: toNumber(cobranca.valor),
      vencimento: cobranca.vencimento.toISOString(),
      billingType: mapBillingTypeToFormaPagamento(asaasData?.billingType) ?? cobranca.formaPagamento,
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
      planName:
        cobranca.matricula?.combo?.nome ??
        cobranca.matricula?.plano?.nome ??
        resolvePlanName({
          matriculaId: cobranca.matriculaId,
          matriculaPlanNames: scope.matriculaPlanNames,
          description: cobranca.descricao,
        }),
      eventId: null,
      externalReference: cobranca.charge?.externalReference ?? null,
      createdAt: cobranca.createdAt.toISOString(),
      pagamento: pagamentoHistorico
        ? {
            id: pagamentoHistorico.id,
            status: pagamentoHistorico.status,
            valorPago: pagamentoHistorico.valorPago,
            dataPagamento: pagamentoHistorico.dataPagamento,
            formaPagamento: pagamentoHistorico.formaPagamento,
            comprovante: pagamentoHistorico.comprovante,
            asaasPaymentId: pagamentoHistorico.asaasPaymentId,
            createdAt: pagamentoHistorico.createdAt,
          }
        : null,
    });
  });
}

function chargeBelongsToScope(
  charge: {
    customerId: string | null;
    familyGroupId: string | null;
    customer?: { payerType: string; payerId: string } | null;
    sale?: {
      alunoId: string | null;
      matriculaId: string | null;
      responsavelId: string | null;
    } | null;
  },
  scope: LedgerScope,
) {
  if (charge.sale?.alunoId && scope.alunoIds.includes(charge.sale.alunoId)) return true;
  if (charge.sale?.matriculaId && scope.matriculaIds.includes(charge.sale.matriculaId)) return true;
  if (charge.familyGroupId && scope.familyGroupIds.includes(charge.familyGroupId)) return true;

  if (scope.pessoa.tipo === 'RESPONSAVEL') {
    if (charge.sale?.responsavelId && scope.responsavelIds.includes(charge.sale.responsavelId)) return true;
    if (charge.customer?.payerType === 'RESPONSAVEL' && scope.responsavelIds.includes(charge.customer.payerId)) {
      return true;
    }
    if (charge.customerId && scope.customerIds.includes(charge.customerId)) return true;
  }

  return charge.customer?.payerType === 'ALUNO' && scope.alunoIds.includes(charge.customer.payerId);
}

async function loadStandaloneChargeItems(contaId: string, scope: LedgerScope): Promise<PersonPaymentLedgerItem[]> {
  const charges = await prisma.charge.findMany({
    where: {
      contaId,
      cobrancaId: null,
      status: { not: 'CANCELED' },
      OR: [
        ...(scope.alunoIds.length ? [{ customer: { payerType: 'ALUNO' as const, payerId: { in: scope.alunoIds } } }] : []),
        ...(scope.alunoIds.length ? [{ sale: { alunoId: { in: scope.alunoIds } } }] : []),
        ...(scope.matriculaIds.length ? [{ sale: { matriculaId: { in: scope.matriculaIds } } }] : []),
        ...(scope.familyGroupIds.length ? [{ familyGroupId: { in: scope.familyGroupIds } }] : []),
        ...(scope.pessoa.tipo === 'RESPONSAVEL' && scope.responsavelIds.length
          ? [
              { customer: { payerType: 'RESPONSAVEL' as const, payerId: { in: scope.responsavelIds } } },
              { sale: { responsavelId: { in: scope.responsavelIds } } },
            ]
          : []),
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
      familyGroupId: true,
      customer: { select: { payerType: true, payerId: true } },
      standaloneInstallmentPlan: { select: { id: true, installmentCount: true } },
      standaloneSubscription: { select: { id: true, description: true } },
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

  return charges
    .filter((charge) => chargeBelongsToScope(charge, scope))
    .map((charge) => {
      const chargeType = inferStandaloneChargeType(charge);
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
      const value = toNumber(charge.value ?? charge.sale?.total ?? 0);
      const paid = charge.status === 'PAID';
      const paidAt = (charge.statusUpdatedAt ?? charge.updatedAt ?? charge.createdAt).toISOString();
      const payerName =
        charge.payerName ??
        (charge.customer?.payerType === 'RESPONSAVEL'
          ? scope.responsavelNames.get(charge.customer.payerId)
          : charge.customer?.payerType === 'ALUNO'
            ? scope.alunoNames.get(charge.customer.payerId)
            : null) ??
        scope.pessoa.nome;
      const groupId =
        charge.standaloneInstallmentPlanId ??
        charge.standaloneSubscriptionId ??
        charge.familyGroupId ??
        null;
      const parsedInstallment = parseInstallmentFromDescription(sourceDescription);

      return buildLedgerItem({
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
          personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
          customerPayerType: charge.customer?.payerType,
          payerId: charge.customer?.payerId,
          responsavelIds: scope.responsavelIds,
        }),
        valor: value,
        vencimento: charge.dueDate?.toISOString() ?? charge.createdAt.toISOString(),
        billingType: charge.sale?.paymentMethod ?? charge.billingType,
        status: charge.status,
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
        pagamento: paid
          ? {
              id: charge.id,
              status: 'PAID',
              valorPago: value,
              dataPagamento: paidAt,
              formaPagamento: charge.sale?.paymentMethod ?? charge.billingType ?? 'INDEFINIDO',
              comprovante: charge.invoiceUrl,
              asaasPaymentId: charge.asaasPaymentId,
              createdAt: paidAt,
            }
          : null,
      });
    });
}

async function loadDirectStoreSaleItems(contaId: string, scope: LedgerScope): Promise<PersonPaymentLedgerItem[]> {
  const sales = await prisma.sale.findMany({
    where: {
      contaId,
      status: 'CONCLUIDA',
      finalizationType: 'RECEBIMENTO_PRESENCIAL',
      chargeId: null,
      OR: [
        ...(scope.alunoIds.length ? [{ alunoId: { in: scope.alunoIds } }] : []),
        ...(scope.matriculaIds.length ? [{ matriculaId: { in: scope.matriculaIds } }] : []),
        ...(scope.pessoa.tipo === 'RESPONSAVEL' && scope.responsavelIds.length
          ? [{ responsavelId: { in: scope.responsavelIds } }]
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

  return sales.map((sale) => {
    const paidAt = sale.updatedAt?.toISOString() ?? sale.createdAt.toISOString();
    const value = toNumber(sale.total);
    const payerName =
      (sale.responsavelId ? scope.responsavelNames.get(sale.responsavelId) : null) ??
      (sale.alunoId ? scope.alunoNames.get(sale.alunoId) : null) ??
      scope.pessoa.nome;

    return buildLedgerItem({
      id: sale.id,
      sourceKind: 'sale',
      sourceId: sale.id,
      chargeType: 'ONE_TIME',
      origin: 'LOJA',
      tipo: 'LOJA',
      description: `Loja #${String(sale.saleNumber).padStart(4, '0')}`,
      payerName,
      payerRole: resolvePayerRole({
        personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
        payerId: sale.responsavelId,
        responsavelIds: scope.responsavelIds,
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
      eventId: null,
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
  });
}

function mapEventFinancialEntryLedgerStatus(status: string) {
  switch (status) {
    case 'PAID':
    case 'RECEIVED':
      return 'PAID';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'CANCELLED':
      return 'CANCELED';
    default:
      return 'OPEN';
  }
}

function mapEventMapOrderLedgerStatus(status: string) {
  switch (status) {
    case 'CONFIRMED':
      return 'PAID';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

async function loadEventFinancialEntryItems(
  contaId: string,
  scope: LedgerScope,
): Promise<PersonPaymentLedgerItem[]> {
  if (scope.alunoIds.length === 0) return [];

  const assignments = await prisma.eventCostumeAssignment.findMany({
    where: {
      contaId,
      alunoId: { in: scope.alunoIds },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      alunoId: true,
      revenueEntryId: true,
      chargedValue: true,
      isPaid: true,
      eventId: true,
      updatedAt: true,
      createdAt: true,
      costume: { select: { name: true } },
      event: { select: { id: true, name: true } },
    },
  });

  if (assignments.length === 0) return [];

  const assignmentById = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const entryIds = [
    ...new Set(
      assignments
        .map((assignment) => assignment.revenueEntryId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const assignmentIds = assignments.map((assignment) => assignment.id);

  const entries = await prisma.eventFinancialEntry.findMany({
    where: {
      contaId,
      type: 'REVENUE',
      status: { not: 'CANCELLED' },
      originType: { not: 'TICKET_SALE' },
      OR: [
        ...(entryIds.length ? [{ id: { in: entryIds } }] : []),
        ...(assignmentIds.length
          ? [{ originType: 'COSTUME_ASSIGNMENT' as const, originId: { in: assignmentIds } }]
          : []),
      ],
    },
    select: {
      id: true,
      eventId: true,
      category: true,
      description: true,
      expectedAmount: true,
      actualAmount: true,
      dueDate: true,
      status: true,
      paymentMethod: true,
      asaasPaymentId: true,
      proofUrl: true,
      originType: true,
      originId: true,
      realizedAt: true,
      createdAt: true,
      updatedAt: true,
      event: { select: { id: true, name: true } },
    },
    orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
  });

  return entries.map((entry) => {
    const assignment =
      entry.originType === 'COSTUME_ASSIGNMENT' && entry.originId
        ? assignmentById.get(entry.originId)
        : assignments.find((item) => item.revenueEntryId === entry.id) ?? null;
    const payerName =
      (assignment?.alunoId ? scope.alunoNames.get(assignment.alunoId) : null) ?? scope.pessoa.nome;
    const value = toNumber(entry.actualAmount ?? entry.expectedAmount ?? assignment?.chargedValue ?? 0);
    const ledgerStatus = mapEventFinancialEntryLedgerStatus(entry.status);
    const paid = ledgerStatus === 'PAID';
    const paidAt = toIso(entry.realizedAt) ?? toIso(entry.updatedAt) ?? toIso(entry.createdAt);
    const description =
      entry.description ||
      (assignment?.costume?.name
        ? `${entry.event.name} - figurino ${assignment.costume.name}`
        : `${entry.event.name} - ${entry.category}`);

    return buildLedgerItem({
      id: entry.id,
      sourceKind: 'event_financial_entry',
      sourceId: entry.id,
      chargeType: 'EVENT_FINANCIAL_ENTRY',
      origin: 'EVENTOS',
      tipo: 'EVENTOS',
      description,
      payerName,
      payerRole: resolvePayerRole({
        personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
        payerId: null,
        responsavelIds: scope.responsavelIds,
      }),
      valor: value,
      vencimento: entry.dueDate?.toISOString() ?? entry.createdAt.toISOString(),
      billingType: entry.paymentMethod,
      status: ledgerStatus,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: paid ? 'PAGO' : ledgerStatus,
        hasAsaasLink: Boolean(entry.asaasPaymentId),
      }),
      asaasPaymentId: entry.asaasPaymentId,
      matriculaId: null,
      groupId: null,
      familyGroupId: null,
      isGroup: false,
      installmentCount: null,
      installmentsPaid: null,
      installmentLabel: null,
      planName: entry.event.name,
      eventId: entry.event.id,
      originType: entry.originType,
      externalReference: `event-entry:${entry.id}`,
      createdAt: entry.createdAt.toISOString(),
      pagamento: paid
        ? {
            id: entry.id,
            status: 'PAID',
            valorPago: value,
            dataPagamento: paidAt,
            formaPagamento: entry.paymentMethod ?? 'INDEFINIDO',
            comprovante: entry.proofUrl,
            asaasPaymentId: entry.asaasPaymentId,
            createdAt: paidAt ?? entry.createdAt.toISOString(),
          }
        : null,
    });
  });
}

async function loadEventMapOrderItems(contaId: string, scope: LedgerScope): Promise<PersonPaymentLedgerItem[]> {
  const linkedSales = await prisma.eventTicketSale.findMany({
    where: {
      contaId,
      eventMapOrderId: { not: null },
      OR: [
        ...(scope.alunoIds.length ? [{ alunoId: { in: scope.alunoIds } }] : []),
        ...(scope.responsavelIds.length ? [{ responsavelId: { in: scope.responsavelIds } }] : []),
      ],
    },
    select: { eventMapOrderId: true },
  });

  const orderIdsFromSales = [
    ...new Set(
      linkedSales
        .map((sale) => sale.eventMapOrderId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const buyerEmails = [normalizeEmail(scope.pessoa.email)].filter((value): value is string => Boolean(value));

  const orders = await prisma.eventMapOrder.findMany({
    where: {
      contaId,
      status: { notIn: ['CANCELLED', 'EXPIRED'] },
      OR: [
        ...(orderIdsFromSales.length ? [{ id: { in: orderIdsFromSales } }] : []),
        ...(buyerEmails.length
          ? buyerEmails.map((email) => ({ buyerEmail: { equals: email, mode: 'insensitive' as const } }))
          : []),
      ],
    },
    select: {
      id: true,
      eventId: true,
      buyerName: true,
      totalAmount: true,
      status: true,
      paymentMethod: true,
      asaasPaymentId: true,
      invoiceUrl: true,
      expiresAt: true,
      paidAt: true,
      createdAt: true,
      updatedAt: true,
      event: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return orders.map((order) => {
    const ledgerStatus = mapEventMapOrderLedgerStatus(order.status);
    const paid = ledgerStatus === 'PAID';
    const value = toNumber(order.totalAmount);
    const paidAt = toIso(order.paidAt) ?? toIso(order.updatedAt) ?? toIso(order.createdAt);

    return buildLedgerItem({
      id: order.id,
      sourceKind: 'event_map_order',
      sourceId: order.id,
      chargeType: 'EVENT_MAP_ORDER',
      origin: 'EVENTOS',
      tipo: 'EVENTOS',
      description: `${order.event.name} - pedido de ingresso`,
      payerName: order.buyerName || scope.pessoa.nome,
      payerRole: resolvePayerRole({
        personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
        payerId: null,
        responsavelIds: scope.responsavelIds,
      }),
      valor: value,
      vencimento: order.expiresAt?.toISOString() ?? order.createdAt.toISOString(),
      billingType: order.paymentMethod,
      status: ledgerStatus,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: paid ? 'PAGO' : ledgerStatus,
        hasAsaasLink: Boolean(order.asaasPaymentId),
      }),
      asaasPaymentId: order.asaasPaymentId,
      matriculaId: null,
      groupId: null,
      familyGroupId: null,
      isGroup: false,
      installmentCount: null,
      installmentsPaid: null,
      installmentLabel: null,
      planName: order.event.name,
      eventId: order.event.id,
      externalReference: `event-map-order:${order.id}`,
      createdAt: order.createdAt.toISOString(),
      pagamento: paid
        ? {
            id: order.id,
            status: 'PAID',
            valorPago: value,
            dataPagamento: paidAt,
            formaPagamento: order.paymentMethod ?? 'INDEFINIDO',
            comprovante: order.invoiceUrl,
            asaasPaymentId: order.asaasPaymentId,
            createdAt: paidAt ?? order.createdAt.toISOString(),
          }
        : null,
    });
  });
}

async function loadEventItems(contaId: string, scope: LedgerScope): Promise<PersonPaymentLedgerItem[]> {
  const [ticketSales, participants] = await Promise.all([
    prisma.eventTicketSale.findMany({
      where: {
        contaId,
        OR: [
          ...(scope.alunoIds.length ? [{ alunoId: { in: scope.alunoIds } }] : []),
          ...(scope.responsavelIds.length ? [{ responsavelId: { in: scope.responsavelIds } }] : []),
        ],
      },
      select: {
        id: true,
        buyerName: true,
        alunoId: true,
        responsavelId: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        soldAt: true,
        paidAt: true,
        refundedAt: true,
        asaasPaymentId: true,
        notes: true,
        event: { select: { id: true, name: true } },
        lot: { select: { name: true } },
      },
      orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.eventParticipant.findMany({
      where: {
        contaId,
        registrationFeeCharged: { gt: 0 },
        OR: [
          ...(scope.alunoIds.length ? [{ alunoId: { in: scope.alunoIds } }] : []),
          ...(scope.responsavelIds.length ? [{ responsavelId: { in: scope.responsavelIds } }] : []),
        ],
      },
      select: {
        id: true,
        type: true,
        alunoId: true,
        responsavelId: true,
        displayName: true,
        registrationFeeCharged: true,
        isFeePaid: true,
        feePaymentMethod: true,
        feePaidAmount: true,
        feeRefundedAmount: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
        event: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    }),
  ]);

  const saleItems = ticketSales.map((sale) => {
    const paid = sale.status === 'PAID' || sale.status === 'COMPLIMENTARY';
    const refunded = sale.status === 'REFUNDED';
    const payerName =
      sale.buyerName ||
      (sale.responsavelId ? scope.responsavelNames.get(sale.responsavelId) : null) ||
      (sale.alunoId ? scope.alunoNames.get(sale.alunoId) : null) ||
      scope.pessoa.nome;
    const value = toNumber(sale.totalAmount);
    const paidAt = toIso(sale.paidAt) ?? toIso(sale.soldAt);

    return buildLedgerItem({
      id: sale.id,
      sourceKind: 'event_ticket_sale',
      sourceId: sale.id,
      chargeType: 'EVENT_TICKET',
      origin: 'EVENTOS',
      tipo: 'EVENTOS',
      description: `${sale.event.name} - ${sale.lot.name}`,
      payerName,
      payerRole: resolvePayerRole({
        personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
        payerId: sale.responsavelId,
        responsavelIds: scope.responsavelIds,
      }),
      valor: value,
      vencimento: sale.soldAt.toISOString(),
      billingType: sale.paymentMethod,
      status: refunded ? 'REFUNDED' : paid ? 'PAID' : sale.status,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: refunded ? 'REFUNDED' : paid ? 'PAGO' : sale.status,
        hasAsaasLink: Boolean(sale.asaasPaymentId),
      }),
      asaasPaymentId: sale.asaasPaymentId,
      matriculaId: null,
      groupId: null,
      familyGroupId: null,
      isGroup: false,
      installmentCount: null,
      installmentsPaid: null,
      installmentLabel: null,
      planName: sale.event.name,
      eventId: sale.event.id,
      createdAt: sale.soldAt.toISOString(),
      pagamento: paid
        ? {
            id: sale.id,
            status: sale.status,
            valorPago: value,
            dataPagamento: paidAt,
            formaPagamento: sale.paymentMethod,
            comprovante: null,
            asaasPaymentId: sale.asaasPaymentId,
            createdAt: paidAt ?? sale.soldAt.toISOString(),
          }
        : null,
    });
  });

  const participantItems = participants.map((participant) => {
    const paid = participant.isFeePaid;
    const payerName =
      participant.displayName ??
      (participant.responsavelId ? scope.responsavelNames.get(participant.responsavelId) : null) ??
      (participant.alunoId ? scope.alunoNames.get(participant.alunoId) : null) ??
      scope.pessoa.nome;
    const value = toNumber(participant.registrationFeeCharged);
    const paidValue = toNumber(participant.feePaidAmount, value);
    const status = participant.cancelledAt ? 'CANCELED' : paid ? 'PAID' : 'OPEN';

    return buildLedgerItem({
      id: participant.id,
      sourceKind: 'event_participant_fee',
      sourceId: participant.id,
      chargeType: 'EVENT_REGISTRATION_FEE',
      origin: 'EVENTOS',
      tipo: 'EVENTOS',
      description: `${participant.event.name} - taxa de participação`,
      payerName,
      payerRole: resolvePayerRole({
        personType: scope.pessoa.tipo === 'RESPONSAVEL' ? 'RESPONSAVEL' : undefined,
        payerId: participant.responsavelId,
        responsavelIds: scope.responsavelIds,
      }),
      valor: value,
      vencimento: participant.createdAt.toISOString(),
      billingType: participant.feePaymentMethod,
      status,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({ localStatus: paid ? 'PAGO' : status }),
      asaasPaymentId: null,
      matriculaId: null,
      groupId: null,
      familyGroupId: null,
      isGroup: false,
      installmentCount: null,
      installmentsPaid: null,
      installmentLabel: null,
      planName: participant.event.name,
      eventId: participant.event.id,
      createdAt: participant.createdAt.toISOString(),
      pagamento: paid
        ? {
            id: participant.id,
            status: 'PAID',
            valorPago: paidValue,
            dataPagamento: participant.updatedAt.toISOString(),
            formaPagamento: participant.feePaymentMethod ?? 'INDEFINIDO',
            comprovante: null,
            asaasPaymentId: null,
            createdAt: participant.updatedAt.toISOString(),
          }
        : null,
    });
  });

  return [...saleItems, ...participantItems];
}

async function enrichInstallmentMetadata(items: PersonPaymentLedgerItem[]) {
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
          where: { id: { in: standalonePlanIds } },
          select: { id: true, installmentCount: true },
        })
      : Promise.resolve([]),
    academicMatriculaIds.length
      ? prisma.installmentPlan.findMany({
          where: { matriculaId: { in: academicMatriculaIds } },
          select: { id: true, matriculaId: true, installmentCount: true },
        })
      : Promise.resolve([]),
    standalonePlanIds.length
      ? prisma.charge.groupBy({
          by: ['standaloneInstallmentPlanId'],
          where: {
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
            matriculaId: { in: academicMatriculaIds },
            tipo: 'PARCELADA',
            OR: [
              { status: 'PAGO' },
              { pagamentos: { some: {} } },
              { dataPagamento: { not: null } },
              { asaasStatus: { in: [...HISTORICAL_ASAAS_PAYMENT_STATUSES] } },
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

function isPaidItem(item: PersonPaymentLedgerItem) {
  const status = item.pagamento?.status ?? item.status;
  return ['PAGO', 'CONFIRMADO', 'CONFIRMED', 'RECEIVED', 'PAID', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(status);
}

function isOpenItem(item: PersonPaymentLedgerItem) {
  if (item.pagamento || isPaidItem(item)) return false;
  return !['CANCELED', 'CANCELADO', 'REFUNDED', 'ESTORNADO'].includes(item.status);
}

function matchesStatusFilter(item: PersonPaymentLedgerItem, filters: string[]) {
  if (filters.length === 0) return true;
  const status = item.pagamento?.status ?? item.status;
  const variants = new Set([status, status === 'PAID' ? 'PAGO' : status, status === 'PAGO' ? 'PAID' : status]);
  return filters.some((filter) => variants.has(filter));
}

function buildLedgerSummary(items: PersonPaymentLedgerItem[]) {
  const totalPago = items.reduce((sum, item) => sum + (item.pagamento ? item.pagamento.valorPago : 0), 0);
  const totalValor = items.reduce((sum, item) => sum + item.valor, 0);

  return {
    total: items.length,
    totalPago,
    totalValor,
    porCategoria: buildCategorySummary(items),
  };
}

export async function buildPersonPaymentLedger(params: {
  contaId: string;
  personType: PersonPaymentLedgerType;
  personId: string;
}): Promise<PersonPaymentLedgerResult | null> {
  const scope = await resolveLedgerScope(params);
  if (!scope) return null;

  const [academicItems, standaloneItems, directStoreItems, eventItems, eventEntryItems, eventMapOrderItems] =
    await Promise.all([
    loadAcademicItems(params.contaId, scope),
    loadStandaloneChargeItems(params.contaId, scope),
    loadDirectStoreSaleItems(params.contaId, scope),
    loadEventItems(params.contaId, scope),
    loadEventFinancialEntryItems(params.contaId, scope),
    loadEventMapOrderItems(params.contaId, scope),
  ]);

  const coveredEventEntryIds = new Set(eventEntryItems.map((item) => item.sourceId));
  const coveredEventMapOrderIds = new Set(eventMapOrderItems.map((item) => item.sourceId));
  const coveredAsaasPaymentIds = new Set(
    [...eventItems, ...eventEntryItems, ...eventMapOrderItems]
      .map((item) => item.asaasPaymentId)
      .filter((value): value is string => Boolean(value)),
  );

  const filteredStandaloneItems = standaloneItems.filter(
    (item) =>
      !shouldSkipStandaloneChargeInLedger({
        charge: {
          externalReference: item.externalReference,
          asaasPaymentId: item.asaasPaymentId,
        },
        coveredEventEntryIds,
        coveredEventMapOrderIds,
        coveredAsaasPaymentIds,
      }),
  );

  const mergedItems = mergeLedgerItemsByPriority([
    ...academicItems,
    ...filteredStandaloneItems,
    ...directStoreItems,
    ...eventItems,
    ...eventEntryItems,
    ...eventMapOrderItems,
  ]);

  const enrichedItems = await enrichInstallmentMetadata(mergedItems);
  enrichedItems.sort((left, right) => {
    const leftDate = left.pagamento?.dataPagamento ?? left.vencimento ?? left.createdAt;
    const rightDate = right.pagamento?.dataPagamento ?? right.vencimento ?? right.createdAt;
    return new Date(rightDate).getTime() - new Date(leftDate).getTime();
  });

  return {
    pessoa: scope.pessoa,
    cobrancas: enrichedItems,
    resumo: buildLedgerSummary(enrichedItems),
  };
}

export async function listPersonPaymentLedgerIndex(params: {
  contaId: string;
  search?: string;
  statusFilters?: string[];
  page: number;
  pageSize: number;
}) {
  const [alunos, responsaveis] = await Promise.all([
    prisma.aluno.findMany({
      where: {
        contaId: params.contaId,
        ...(params.search ? { nome: { contains: params.search, mode: 'insensitive' as const } } : {}),
      },
      select: {
        id: true,
        dataNasc: true,
        responsaveis: { select: { responsavelId: true }, take: 1 },
      },
      orderBy: { nome: 'asc' },
    }),
    prisma.responsavel.findMany({
      where: {
        contaId: params.contaId,
        ...(params.search ? { nome: { contains: params.search, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true },
      orderBy: { nome: 'asc' },
    }),
  ]);

  const eligibleAlunos = alunos.filter((aluno) => {
    const hasResponsavel = aluno.responsaveis.length > 0;
    if (!hasResponsavel || !aluno.dataNasc) return true;
    return !isMenorDeIdade(new Date(aluno.dataNasc));
  });

  const ledgers = (
    await Promise.all([
      ...eligibleAlunos.map((aluno) =>
        buildPersonPaymentLedger({ contaId: params.contaId, personType: 'ALUNO', personId: aluno.id }),
      ),
      ...responsaveis.map((responsavel) =>
        buildPersonPaymentLedger({
          contaId: params.contaId,
          personType: 'RESPONSAVEL',
          personId: responsavel.id,
        }),
      ),
    ])
  ).filter((ledger): ledger is PersonPaymentLedgerResult => Boolean(ledger));

  const statusFilters = (params.statusFilters ?? []).map((status) => status.trim().toUpperCase()).filter(Boolean);
  const items = ledgers
    .map((ledger) => {
      const filteredCobrancas = ledger.cobrancas.filter((item) => matchesStatusFilter(item, statusFilters));
      const paidItems = filteredCobrancas.filter(
        (item) => item.pagamento && (item.pagamento.valorPago ?? 0) > 0,
      );
      const payments =
        ledger.pessoa.tipo === 'ALUNO'
          ? paidItems.filter((item) => item.payerRole === 'ALUNO')
          : paidItems;
      const openItems = filteredCobrancas.filter(isOpenItem);
      const ultimoPagamento = payments
        .map((item) => item.pagamento?.dataPagamento ?? item.pagamento?.createdAt ?? item.createdAt)
        .filter((date): date is string => Boolean(date))
        .sort((left, right) => right.localeCompare(left))[0] ?? null;

      return {
        ...ledger.pessoa,
        alunosVinculados: [],
        totalPagamentos: payments.reduce((sum, item) => sum + (item.pagamento?.valorPago ?? 0), 0),
        valorTotal: payments.reduce((sum, item) => sum + (item.pagamento?.valorPago ?? 0), 0),
        valorEmAberto: openItems.reduce((sum, item) => sum + item.valor, 0),
        ultimoPagamento,
        pagamentosCount: payments.length,
        cobrancasAbertasCount: openItems.length,
        _sortDate: ultimoPagamento ?? filteredCobrancas[0]?.createdAt ?? null,
        _hasHistory: payments.length > 0,
      };
    })
    .filter((item) => item._hasHistory)
    .sort((left, right) => {
      if (left._sortDate && right._sortDate) return right._sortDate.localeCompare(left._sortDate);
      if (left._sortDate) return -1;
      if (right._sortDate) return 1;
      return left.nome.localeCompare(right.nome);
    });

  const total = items.length;
  const data = items.slice((params.page - 1) * params.pageSize, params.page * params.pageSize).map((item) => {
    const { _sortDate, _hasHistory, ...publicItem } = item;
    void _sortDate;
    void _hasHistory;
    return publicItem;
  });

  return {
    data,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };
}

