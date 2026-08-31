import { prisma } from '@alusa/database';
import type { ChargeListItemDTO, UnifiedChargeStatus } from '../dtos/charge-list-item.dto';
import {
  ASAAS_NON_OPEN_UNIFIED_STATUSES,
  ASAAS_PAID_UNIFIED_STATUSES,
  resolveUnifiedChargeStatus,
} from '../dtos/unified-billing';
import { parseExternalReference } from '../core';
import { resolveChargeDisplayStatus } from '../mappers/asaas-display-status';
import { isMaterializedGroupedEventEntry } from '../mappers/event-billing-entry';
import { resolveEventPayerName } from '../mappers/event-payer';

export type ChargeOrigin = 'ACADEMIC' | 'STANDALONE' | 'all';

/**
 * Extrai installmentPlanId do externalReference
 * Suporta V1 (installmentPlan:{planId}:payment:{paymentId}) e V2 (alusa:installment:{planId}:{subcontaId})
 */
function extractInstallmentPlanId(externalReference: string | null): string | null {
  if (!externalReference) return null;
  
  // Tentar V2 primeiro
  const parsed = parseExternalReference(externalReference);
  if (parsed && parsed.type === 'installment' && parsed.ids.installmentPlanId) {
    return parsed.ids.installmentPlanId;
  }
  if (parsed && parsed.type === 'payment' && parsed.ids.installmentPlanId) {
    return parsed.ids.installmentPlanId;
  }
  
  // Fallback V1
  if (!externalReference.startsWith('installmentPlan:')) return null;
  const rest = externalReference.slice('installmentPlan:'.length);
  if (rest.startsWith('pending:')) {
    return rest.slice('pending:'.length).split(':')[0] || null;
  }
  return rest.split(':')[0] || null;
}

export type ListChargesAggregatedInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  statusFilter?: string[];
  statusView?: 'open' | 'paid' | 'all';
  tipoFilter?: string[];
  search?: string;
  /** Filtrar por origem: ACADEMIC (Cobranca), STANDALONE (Charge sem vínculo), ou 'all' */
  origin?: ChargeOrigin;
  /** Se true, agrupa parcelamentos em um único item (default: true) */
  groupInstallments?: boolean;
};

export type ListChargesAggregatedOutput = {
  items: ChargeListItemDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function mapEventFinancialEntryStatus(status: string): UnifiedChargeStatus {
  switch (status) {
    case 'PAID':
    case 'RECEIVED':
      return 'PAID';
    case 'CANCELLED':
      return 'CANCELED';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'EXPECTED':
    case 'PENDING':
    default:
      return 'PENDING';
  }
}

function mapEventTicketSaleStatus(status: string): UnifiedChargeStatus {
  switch (status) {
    case 'PAID':
    case 'COMPLIMENTARY':
      return 'PAID';
    case 'CANCELLED':
      return 'CANCELED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'PENDING':
    default:
      return 'PENDING';
  }
}

function mapEventMapOrderStatus(status: string): UnifiedChargeStatus {
  switch (status) {
    case 'CONFIRMED':
      return 'PAID';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELED';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'PAYMENT_PENDING':
    default:
      return 'PENDING';
  }
}

function resolveEventFinancialPayerName(entry: {
  payments?: Array<{
    participant?: {
      displayName: string | null;
      aluno: { nome: string } | null;
      responsavel: { nome: string } | null;
    } | null;
  }>;
}, additionalCandidates: Array<{
  responsibleName: string | null;
  studentName: string | null;
  displayName: string | null;
}> = []) {
  const paymentCandidates = (entry.payments ?? []).map((payment) => ({
    responsibleName: payment.participant?.responsavel?.nome ?? null,
    studentName: payment.participant?.aluno?.nome ?? null,
    displayName: payment.participant?.displayName ?? null,
  }));
  return resolveEventPayerName([...additionalCandidates, ...paymentCandidates]) ?? '-';
}

function matchesStatusView(status: UnifiedChargeStatus, statusView: 'open' | 'paid' | 'all') {
  if (statusView === 'all') return true;
  if (statusView === 'paid') return status === 'PAID';
  return ['PENDING', 'PROCESSING', 'OVERDUE'].includes(status);
}

function addAndCondition(where: Record<string, unknown>, condition: Record<string, unknown>) {
  where.AND = [
    ...((Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []) as unknown[]),
    condition,
  ];
}

// Mapeamento de FormaPagamento para billing type
function mapBillingType(formaPagamento: string | null): string | null {
  if (!formaPagamento) return null;
  switch (formaPagamento) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CARTAO_CREDITO':
      return 'CREDIT_CARD';
    case 'CARTAO_DEBITO':
      return 'DEBIT_CARD';
    case 'INDEFINIDO':
      return 'UNDEFINED';
    default:
      return formaPagamento;
  }
}

// Mapeamento de TipoCobranca para descrição legível
function mapTipoToDescription(tipo: string): string {
  switch (tipo) {
    case 'MENSALIDADE':
      return 'Mensalidade';
    case 'TAXA_MATRICULA':
      return 'Taxa de Matrícula';
    case 'MATERIAL':
      return 'Material';
    case 'UNIFORME':
      return 'Uniforme';
    case 'EXTRA':
      return 'Extra';
    case 'AVULSA':
      return 'Cobrança Avulsa';
    case 'PARCELADA':
      return 'Parcelamento';
    case 'RECORRENTE':
      return 'Recorrente';
    default:
      return tipo;
  }
}

export async function listChargesAggregated(
  input: ListChargesAggregatedInput,
  /** Prisma client override (DI para testes) */
  db?: typeof prisma,
): Promise<ListChargesAggregatedOutput> {
  const _db = db ?? prisma;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const { contaId, statusFilter, statusView = 'open', tipoFilter, search, origin = 'all' } = input;
  const auxiliaryFetchLimit = pageSize * 2;

  // Skip queries based on origin filter
  const includeAcademic = origin === 'all' || origin === 'ACADEMIC';
  const includeStandalone = origin === 'all' || origin === 'STANDALONE';

  // ==================== Query 1: Cobranças Acadêmicas ====================
  const academicWhere: Record<string, unknown> = {
    matricula: { aluno: { contaId } },
  };

  // Aplicar filtros de status
  if (statusFilter?.length) {
    academicWhere.status = { in: statusFilter };
  } else if (statusView === 'open') {
    addAndCondition(academicWhere, {
      OR: [
        {
          status: {
            in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'],
          },
        },
      ],
    });
    addAndCondition(academicWhere, {
      OR: [
        { asaasStatus: null },
        { asaasStatus: { notIn: [...ASAAS_NON_OPEN_UNIFIED_STATUSES] } },
      ],
    });
  } else if (statusView === 'paid') {
    addAndCondition(academicWhere, {
      OR: [
        { status: 'PAGO' },
        { asaasStatus: { in: [...ASAAS_PAID_UNIFIED_STATUSES] } },
      ],
    });
  }

  if (tipoFilter?.length) {
    academicWhere.tipo = { in: tipoFilter };
  }

  if (search) {
    const searchOr = [
      { matricula: { aluno: { nome: { contains: search, mode: 'insensitive' } } } },
      { descricao: { contains: search, mode: 'insensitive' } },
    ];
    addAndCondition(academicWhere, { OR: searchOr });
  }

  // ==================== Query 2: Cobranças Standalone ====================
  const standaloneWhere: Record<string, unknown> = {
    contaId,
    cobrancaId: null, // Apenas charges sem vínculo acadêmico
  };

  // Mapear statusFilter para ChargeStatus
  if (statusFilter?.length) {
    const chargeStatuses: string[] = [];
    for (const s of statusFilter) {
      if (['A_VENCER', 'PENDENTE'].includes(s)) {
        chargeStatuses.push('CREATED', 'OPEN');
      } else if (s === 'PAGO') {
        chargeStatuses.push('PAID');
      } else if (s === 'ATRASADO') {
        chargeStatuses.push('OVERDUE');
      } else if (['CANCELADO', 'CANCELAMENTO_PENDENTE'].includes(s)) {
        chargeStatuses.push('CANCELED');
      } else if (['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(s)) {
        chargeStatuses.push('REFUNDED');
      }
    }
    if (chargeStatuses.length) {
      standaloneWhere.status = { in: [...new Set(chargeStatuses)] };
    }
  } else if (statusView === 'open') {
    standaloneWhere.status = { in: ['CREATED', 'OPEN', 'OVERDUE'] };
    addAndCondition(standaloneWhere, {
      OR: [
        { asaasStatus: null },
        { asaasStatus: { notIn: [...ASAAS_NON_OPEN_UNIFIED_STATUSES] } },
      ],
    });
  } else if (statusView === 'paid') {
    addAndCondition(standaloneWhere, {
      OR: [
        { status: 'PAID' },
        { asaasStatus: { in: [...ASAAS_PAID_UNIFIED_STATUSES] } },
      ],
    });
  }

  // ==================== Executar queries em paralelo ====================
  // Buscar Charges vinculadas para extrair installmentPlanId (quando groupInstallments=true)
  const shouldGroup = input.groupInstallments !== false; // default true

  const eventFinancialEntryWhere: Record<string, unknown> = {
    contaId,
    type: 'REVENUE',
    NOT: { originType: 'TICKET_SALE' },
  };
  const eventTicketSaleWhere: Record<string, unknown> = { contaId };
  const eventMapOrderWhere: Record<string, unknown> = { contaId };
  const standaloneSubscriptionWhere: Record<string, unknown> = { contaId };

  if (search) {
    eventFinancialEntryWhere.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
      { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
    ];
    eventTicketSaleWhere.OR = [
      { buyerName: { contains: search, mode: 'insensitive' } },
      { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
    ];
    eventMapOrderWhere.OR = [
      { buyerName: { contains: search, mode: 'insensitive' } },
      { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
    ];
    standaloneSubscriptionWhere.OR = [
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [
    academicResult,
    standaloneResult,
    academicCount,
    standaloneCount,
    linkedCharges,
    standaloneSubscriptions,
    eventFinancialEntriesResult,
    eventTicketSales,
    eventMapOrders,
  ] = await Promise.all([
    includeAcademic
      ? _db.cobranca.findMany({
          where: academicWhere,
          // Parcelamentos precisam ser carregados completos antes do agrupamento.
          // Limitar por createdAt aqui pode remover a primeira parcela do plano.
          orderBy: [{ vencimento: 'asc' }, { createdAt: 'desc' }],
          include: {
            matricula: {
              select: {
                id: true,
                aluno: { select: { id: true, nome: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    includeStandalone
      ? _db.charge.findMany({
          where: standaloneWhere,
          // O agrupamento ocorre depois da consulta; limitar antes dele quebra
          // a integridade do parcelamento e pode exibir uma parcela posterior.
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            contaId: true,
            externalReference: true,
            status: true,
            statusUpdatedAt: true,
            asaasPaymentId: true,
            asaasStatus: true,
            liquidacaoStatus: true,
            createdAt: true,
            // Novos campos para listagem
            payerName: true,
            description: true,
            value: true,
            dueDate: true,
            billingType: true,
            standaloneInstallmentPlanId: true,
            standaloneSubscriptionId: true,
          },
        })
      : Promise.resolve([]),
    includeAcademic ? _db.cobranca.count({ where: academicWhere }) : Promise.resolve(0),
    includeStandalone ? _db.charge.count({ where: standaloneWhere }) : Promise.resolve(0),
    // Buscar Charges vinculadas às cobranças para extrair installmentPlanId
    shouldGroup && includeAcademic
      ? _db.charge.findMany({
          where: {
            contaId,
            cobrancaId: { not: null },
            OR: [
              { externalReference: { startsWith: 'installmentPlan:' } },
              { externalReference: { startsWith: 'alusa:installment:' } },
            ],
          },
          select: {
            cobrancaId: true,
            externalReference: true,
            status: true,
            asaasStatus: true,
          },
        })
      : Promise.resolve([]),
    includeStandalone
      ? _db.standaloneSubscription.findMany({
          where: standaloneSubscriptionWhere,
          orderBy: { createdAt: 'desc' },
          take: auxiliaryFetchLimit,
          select: {
            id: true,
            status: true,
            customerId: true,
            asaasSubscriptionId: true,
            billingType: true,
            value: true,
            nextDueDate: true,
            description: true,
            familyGroupId: true,
            createdAt: true,
            customer: { select: { payerType: true, payerId: true } },
          },
        })
      : Promise.resolve([]),
    _db.eventFinancialEntry.findMany({
      where: eventFinancialEntryWhere,
      orderBy: { createdAt: 'desc' },
      take: auxiliaryFetchLimit,
      select: {
        id: true,
        eventId: true,
        category: true,
        description: true,
        expectedAmount: true,
        dueDate: true,
        status: true,
        paymentMethod: true,
        paymentProvider: true,
        actualAmount: true,
        asaasPaymentId: true,
        createdAt: true,
        payments: {
          orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            participant: {
              select: {
                displayName: true,
                aluno: { select: { nome: true } },
                responsavel: { select: { nome: true } },
              },
            },
          },
        },
        event: { select: { name: true } },
      },
    }),
    _db.eventTicketSale.findMany({
      where: eventTicketSaleWhere,
      orderBy: { createdAt: 'desc' },
      take: auxiliaryFetchLimit,
      select: {
        id: true,
        eventId: true,
        buyerName: true,
        alunoId: true,
        quantity: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        soldAt: true,
        asaasPaymentId: true,
        createdAt: true,
        event: { select: { name: true } },
      },
    }),
    _db.eventMapOrder.findMany({
      where: eventMapOrderWhere,
      orderBy: { createdAt: 'desc' },
      take: auxiliaryFetchLimit,
      select: {
        id: true,
        eventId: true,
        buyerName: true,
        totalAmount: true,
        status: true,
        paymentMethod: true,
        paymentProvider: true,
        asaasPaymentId: true,
        invoiceUrl: true,
        expiresAt: true,
        createdAt: true,
        event: { select: { name: true } },
      },
    }),
  ]);

  const rawEventFinancialEntries = eventFinancialEntriesResult;
  const eventRevenueEntryIds = rawEventFinancialEntries.map((entry) => entry.id);
  const eventParticipants = eventRevenueEntryIds.length
    ? await _db.eventParticipant.findMany({
        where: { contaId, revenueEntryId: { in: eventRevenueEntryIds } },
        select: {
          revenueEntryId: true,
          billingGroupId: true,
          standaloneChargeId: true,
          asaasPaymentId: true,
          asaasInstallmentId: true,
          displayName: true,
          aluno: { select: { nome: true } },
          responsavel: { select: { nome: true } },
        },
      })
    : [];
  const eventPayerCandidatesByEntry = new Map<string, Array<{
    responsibleName: string | null;
    studentName: string | null;
    displayName: string | null;
  }>>();
  for (const participant of eventParticipants) {
    if (!participant.revenueEntryId) continue;
    const candidates = eventPayerCandidatesByEntry.get(participant.revenueEntryId) ?? [];
    candidates.push({
      responsibleName: participant.responsavel?.nome ?? null,
      studentName: participant.aluno?.nome ?? null,
      displayName: participant.displayName,
    });
    eventPayerCandidatesByEntry.set(participant.revenueEntryId, candidates);
  }

  const eventPlanIds = Array.from(new Set(
    eventParticipants
      .flatMap((participant) => [participant.standaloneChargeId].filter((value): value is string => Boolean(value))),
  ));
  const eventPlans = eventPlanIds.length
    ? await _db.standaloneInstallmentPlan.findMany({
        where: { contaId, id: { in: eventPlanIds }, status: { in: ['ACTIVE', 'COMPLETED'] } },
        select: { id: true, asaasInstallmentId: true },
      })
    : [];
  const materializedEventPlanReferences = new Set(
    eventPlans.flatMap((plan) => [plan.id, plan.asaasInstallmentId].filter((value): value is string => Boolean(value))),
  );
  const eventFinancialEntries = rawEventFinancialEntries.filter((entry) => {
    const participant = eventParticipants.find((candidate) => candidate.revenueEntryId === entry.id);
    return !isMaterializedGroupedEventEntry(
      entry,
      participant,
      materializedEventPlanReferences,
    );
  });

  // Criar mapa de cobrancaId -> installmentPlanId
  const cobrancaToInstallmentPlan = new Map<string, string>();
  for (const charge of linkedCharges) {
    if (charge.cobrancaId) {
      const planId = extractInstallmentPlanId(charge.externalReference);
      if (planId) {
        cobrancaToInstallmentPlan.set(charge.cobrancaId, planId);
      } else if (charge.externalReference && charge.externalReference.includes('installment')) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('[finance][listChargesAggregated] installmentPlanId não resolvido', {
            cobrancaId: charge.cobrancaId,
            externalReference: charge.externalReference,
          });
        }
      }
    }
  }

  // ==================== Normalizar para DTO ====================
  const academicItems: ChargeListItemDTO[] = academicResult.map((c) => ({
    id: c.id,
    origin: 'ACADEMIC' as const,
    description: c.descricao || mapTipoToDescription(c.tipo),
    payerName: c.matricula.aluno.nome,
    value: Number(c.valor),
    dueDate: c.vencimento?.toISOString() ?? null,
    billingType: mapBillingType(c.formaPagamento),
    status: resolveUnifiedChargeStatus({
      localStatus: c.status,
      asaasStatus: c.asaasStatus,
      liquidacaoStatus: c.liquidacaoStatus,
      hasAsaasLink: Boolean(c.asaasPaymentId),
    }),
    asaasStatus: c.asaasStatus,
    liquidacaoStatus: c.liquidacaoStatus,
    displayStatus: resolveChargeDisplayStatus({
      localStatus: c.status,
      asaasStatus: c.asaasStatus,
      liquidacaoStatus: c.liquidacaoStatus,
      hasAsaasLink: Boolean(c.asaasPaymentId),
    }),
    createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
    sourceId: c.id,
    matriculaId: c.matriculaId,
    alunoId: c.matricula.aluno.id,
    asaasPaymentId: c.asaasPaymentId,
    tipo: c.tipo,
    // Adicionar installmentPlanId para cobranças PARCELADA
    installmentPlanId: cobrancaToInstallmentPlan.get(c.id) ?? null,
  }));

  // Para standalone, usar os campos de snapshot salvos na criação
  const standaloneItems: ChargeListItemDTO[] = [];
  // Registros legados podem não ter o FK preenchido, mas ainda possuem o plano
  // no externalReference. O identificador resolvido será usado para agrupá-los.

  for (const c of standaloneResult) {
    const resolvedInstallmentPlanId =
      c.standaloneInstallmentPlanId ?? extractInstallmentPlanId(c.externalReference);

    standaloneItems.push({
      id: c.id,
      origin: 'STANDALONE' as const,
      description: c.description ?? 'Cobrança Avulsa',
      payerName: c.payerName ?? 'Cliente',
      value: c.value != null ? Number(c.value) : 0,
      dueDate: c.dueDate?.toISOString() ?? null,
      billingType: c.billingType,
      status: resolveUnifiedChargeStatus({
        localStatus: c.status,
        asaasStatus: c.asaasStatus,
        liquidacaoStatus: c.liquidacaoStatus,
        hasAsaasLink: Boolean(c.asaasPaymentId),
      }),
      asaasStatus: c.asaasStatus,
      liquidacaoStatus: c.liquidacaoStatus,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: c.status,
        asaasStatus: c.asaasStatus,
        liquidacaoStatus: c.liquidacaoStatus,
        hasAsaasLink: Boolean(c.asaasPaymentId),
      }),
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      sourceId: c.id,
      matriculaId: null,
      alunoId: null,
      asaasPaymentId: c.asaasPaymentId,
      tipo: resolvedInstallmentPlanId ? 'PARCELADA' : 'AVULSA',
      installmentPlanId: resolvedInstallmentPlanId,
    });
  }

  const materializedSubscriptionIds = new Set(
    standaloneResult
      .map((charge) => charge.standaloneSubscriptionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const subscriptionPayerIdsByType = {
    ALUNO: standaloneSubscriptions
      .filter((subscription) => subscription.customer?.payerType === 'ALUNO')
      .map((subscription) => subscription.customer.payerId),
    RESPONSAVEL: standaloneSubscriptions
      .filter((subscription) => subscription.customer?.payerType === 'RESPONSAVEL')
      .map((subscription) => subscription.customer.payerId),
  };

  const [subscriptionAlunos, subscriptionResponsaveis] = await Promise.all([
    subscriptionPayerIdsByType.ALUNO.length
      ? _db.aluno.findMany({
          where: { id: { in: subscriptionPayerIdsByType.ALUNO } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
    subscriptionPayerIdsByType.RESPONSAVEL.length
      ? _db.responsavel.findMany({
          where: { id: { in: subscriptionPayerIdsByType.RESPONSAVEL } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
  ]);

  const subscriptionPayerName = new Map<string, string>([
    ...subscriptionAlunos.map((aluno) => [`ALUNO:${aluno.id}`, aluno.nome] as const),
    ...subscriptionResponsaveis.map((responsavel) => [`RESPONSAVEL:${responsavel.id}`, responsavel.nome] as const),
  ]);

  const standaloneSubscriptionItems: ChargeListItemDTO[] = standaloneSubscriptions
    .filter((subscription) => {
      if (materializedSubscriptionIds.has(subscription.id)) return false;
      if (tipoFilter?.length && !tipoFilter.includes('RECORRENTE')) return false;
      return statusView !== 'paid';
    })
    .map((subscription) => ({
      id: `group:subscription:${subscription.id}`,
      origin: 'STANDALONE' as const,
      description: subscription.description ?? 'Assinatura recorrente',
      payerName: subscription.customer
        ? subscriptionPayerName.get(`${subscription.customer.payerType}:${subscription.customer.payerId}`) ?? 'Cliente'
        : 'Cliente',
      value: Number(subscription.value),
      dueDate: subscription.nextDueDate.toISOString(),
      billingType: subscription.billingType,
      status: 'PENDING' as const,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({ localStatus: 'PENDING' }),
      createdAt: subscription.createdAt.toISOString(),
      sourceId: subscription.id,
      matriculaId: null,
      alunoId: subscription.customer?.payerType === 'ALUNO' ? subscription.customer.payerId : null,
      asaasPaymentId: null,
      tipo: 'RECORRENTE',
      isGroup: true,
      groupType: 'SUBSCRIPTION',
      installmentPlanId: subscription.id,
      installmentCount: undefined,
      installmentsPaid: undefined,
    }));

  const eventItems: ChargeListItemDTO[] = [
    ...eventFinancialEntries.map((entry) => ({
      id: `event-entry:${entry.id}`,
      origin: 'EVENT' as const,
      description: `${entry.event.name} · ${entry.description || entry.category}`,
      payerName: resolveEventFinancialPayerName(
        entry,
        eventPayerCandidatesByEntry.get(entry.id) ?? [],
      ),
      value: Number(entry.expectedAmount),
      dueDate: entry.dueDate?.toISOString() ?? null,
      billingType: entry.paymentMethod,
      status: mapEventFinancialEntryStatus(entry.status),
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: mapEventFinancialEntryStatus(entry.status) === 'PAID' ? 'PAGO' : entry.status,
        hasAsaasLink: Boolean(entry.asaasPaymentId),
      }),
      createdAt: entry.createdAt.toISOString(),
      sourceId: entry.id,
      matriculaId: null,
      alunoId: null,
      eventId: entry.eventId,
      asaasPaymentId: entry.asaasPaymentId,
      tipo: 'EVENTO',
    })),
    ...eventTicketSales.map((sale) => ({
      id: `event-ticket-sale:${sale.id}`,
      origin: 'EVENT' as const,
      description: `${sale.event.name} · ${sale.quantity} ingresso(s)`,
      payerName: sale.buyerName,
      value: Number(sale.totalAmount),
      dueDate: sale.soldAt.toISOString(),
      billingType: sale.paymentMethod,
      status: mapEventTicketSaleStatus(sale.status),
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: mapEventTicketSaleStatus(sale.status) === 'PAID' ? 'PAGO' : sale.status,
        hasAsaasLink: Boolean(sale.asaasPaymentId),
      }),
      createdAt: sale.createdAt.toISOString(),
      sourceId: sale.id,
      matriculaId: null,
      alunoId: sale.alunoId,
      eventId: sale.eventId,
      asaasPaymentId: sale.asaasPaymentId,
      tipo: 'EVENTO',
    })),
    ...eventMapOrders.map((order) => ({
      id: `event-map-order:${order.id}`,
      origin: 'EVENT' as const,
      description: `${order.event.name} · Pedido de ingresso`,
      payerName: order.buyerName,
      value: Number(order.totalAmount),
      dueDate: order.expiresAt?.toISOString() ?? null,
      billingType: order.paymentMethod ?? order.paymentProvider,
      status: mapEventMapOrderStatus(order.status),
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: resolveChargeDisplayStatus({
        localStatus: mapEventMapOrderStatus(order.status) === 'PAID' ? 'PAGO' : order.status,
        hasAsaasLink: Boolean(order.asaasPaymentId),
      }),
      createdAt: order.createdAt.toISOString(),
      sourceId: order.id,
      matriculaId: null,
      alunoId: null,
      eventId: order.eventId,
      asaasPaymentId: order.asaasPaymentId,
      tipo: 'EVENTO',
    })),
  ].filter((item) => {
    if (tipoFilter?.length && !tipoFilter.includes(item.tipo ?? '')) return false;
    return matchesStatusView(item.status, statusView);
  });

  // ==================== Agrupar parcelamentos (se habilitado) ====================
  let processedItems: ChargeListItemDTO[];
  let groupedAcademicCount = 0;
  let groupedStandaloneCount = 0;

  if (shouldGroup) {
    // Separar itens por tipo
    const installmentItems: ChargeListItemDTO[] = [];
    const otherItems: ChargeListItemDTO[] = [];

    for (const item of academicItems) {
      if (item.tipo === 'PARCELADA' && item.installmentPlanId) {
        installmentItems.push(item);
      } else {
        if (item.tipo === 'PARCELADA' && !item.installmentPlanId) {
          continue;
        }
        otherItems.push(item);
      }
    }

    const standaloneInstallmentItems = standaloneItems.filter((item) => item.installmentPlanId);
    const standaloneOtherItems = standaloneItems.filter((item) => !item.installmentPlanId);

    // Agrupar parcelas por installmentPlanId (acadêmico)
    const groupedByPlan = new Map<string, ChargeListItemDTO[]>();
    for (const item of installmentItems) {
      const planId = item.installmentPlanId!;
      if (!groupedByPlan.has(planId)) {
        groupedByPlan.set(planId, []);
      }
      groupedByPlan.get(planId)!.push(item);
    }

    // Buscar dados dos InstallmentPlans para criar itens de grupo
    const planIds = Array.from(groupedByPlan.keys());
    const installmentPlans =
      planIds.length > 0
        ? await _db.installmentPlan.findMany({
            where: { id: { in: planIds } },
            select: {
              id: true,
              installmentCount: true,
              value: true,
              billingType: true,
              firstDueDate: true,
              createdAt: true,
              matricula: {
                select: {
                  id: true,
                  aluno: { select: { id: true, nome: true } },
                },
              },
            },
          })
        : [];

    // Criar mapa de planos
    const planMap = new Map(installmentPlans.map((p) => [p.id, p]));

    // Criar itens de grupo
    const groupItems: ChargeListItemDTO[] = [];
    for (const [planId, parcelas] of groupedByPlan) {
      const plan = planMap.get(planId);
      if (!plan) continue;

      // Ordenar parcelas por vencimento
      parcelas.sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return 0;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

      // Contar parcelas pagas
      const paidCount = parcelas.filter((p) => p.status === 'PAID').length;

      // Calcular valor total e próximo vencimento
      const totalValue = Number(plan.value) * plan.installmentCount;
      const nextDue = parcelas.find((p) => p.status !== 'PAID' && p.status !== 'CANCELED');

      // Determinar status do grupo
      let groupStatus: UnifiedChargeStatus = 'PENDING';
      if (paidCount === plan.installmentCount) {
        groupStatus = 'PAID';
      } else if (parcelas.some((p) => p.status === 'OVERDUE')) {
        groupStatus = 'OVERDUE';
      } else if (parcelas.every((p) => p.status === 'CANCELED')) {
        groupStatus = 'CANCELED';
      }

      // Extrair descrição base (remover "Parcela X/Y - ")
      const baseDescription =
        parcelas[0]?.description?.replace(/^Parcela \d+\/\d+ - /, '') || 'Parcelamento';

      groupItems.push({
        id: `group:installment:${planId}`,
        origin: 'ACADEMIC',
        description: `Parcelamento ${plan.installmentCount}x - ${baseDescription}`,
        payerName: plan.matricula.aluno.nome,
        value: totalValue,
        dueDate: nextDue?.dueDate ?? parcelas[parcelas.length - 1]?.dueDate ?? null,
        billingType: plan.billingType,
        status: groupStatus,
        asaasStatus: null,
        liquidacaoStatus: null,
        displayStatus: resolveChargeDisplayStatus({ localStatus: groupStatus === 'PAID' ? 'PAGO' : groupStatus }),
        createdAt: plan.createdAt.toISOString(),
        sourceId: planId,
        matriculaId: plan.matricula.id,
        alunoId: plan.matricula.aluno.id,
        asaasPaymentId: null,
        tipo: 'PARCELADA',
        // Campos de grupo
        isGroup: true,
        groupType: 'INSTALLMENT',
        installmentPlanId: planId,
        installmentCount: plan.installmentCount,
        installmentsPaid: paidCount,
        installments: parcelas,
      });
    }

    // Agrupar parcelas por installmentPlanId (standalone)
    const groupedStandalone = new Map<string, ChargeListItemDTO[]>();
    for (const item of standaloneInstallmentItems) {
      const planId = item.installmentPlanId!;
      if (!groupedStandalone.has(planId)) {
        groupedStandalone.set(planId, []);
      }
      groupedStandalone.get(planId)!.push(item);
    }

    const standalonePlanIds = Array.from(groupedStandalone.keys());
    const standalonePlans = standalonePlanIds.length
      ? await _db.standaloneInstallmentPlan.findMany({
          where: { id: { in: standalonePlanIds } },
          select: {
            id: true,
            installmentCount: true,
            value: true,
            billingType: true,
            firstDueDate: true,
            createdAt: true,
            customer: { select: { payerType: true, payerId: true } },
          },
        })
      : [];

    const responsavelIds = standalonePlans
      .filter((p) => p.customer.payerType === 'RESPONSAVEL')
      .map((p) => p.customer.payerId);
    const alunoIds = standalonePlans
      .filter((p) => p.customer.payerType === 'ALUNO')
      .map((p) => p.customer.payerId);

    const [responsaveis, alunos] = await Promise.all([
      responsavelIds.length
        ? _db.responsavel.findMany({ where: { id: { in: responsavelIds } }, select: { id: true, nome: true } })
        : Promise.resolve([]),
      alunoIds.length
        ? _db.aluno.findMany({ where: { id: { in: alunoIds } }, select: { id: true, nome: true } })
        : Promise.resolve([]),
    ]);

    const responsavelMap = new Map(responsaveis.map((r) => [r.id, r.nome]));
    const alunoMap = new Map(alunos.map((a) => [a.id, a.nome]));

    const standalonePlanMap = new Map(standalonePlans.map((p) => [p.id, p]));
    const standaloneGroupItems: ChargeListItemDTO[] = [];

    for (const [planId, parcelas] of groupedStandalone) {
      const plan = standalonePlanMap.get(planId);
      // Não descarte uma cobrança legítima se o plano local ainda não foi
      // reconciliado. Ela permanece visível individualmente até a correção do
      // vínculo, evitando que a primeira parcela desapareça da operação.
      if (!plan) {
        standaloneOtherItems.push(...parcelas);
        continue;
      }

      parcelas.sort((a, b) => {
        if (!a.dueDate || !b.dueDate) return 0;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

      const paidCount = parcelas.filter((p) => p.status === 'PAID').length;
      const totalValue = Number(plan.value);
      const nextDue = parcelas.find((p) => p.status !== 'PAID' && p.status !== 'CANCELED');

      let groupStatus: UnifiedChargeStatus = 'PENDING';
      if (paidCount === plan.installmentCount) {
        groupStatus = 'PAID';
      } else if (parcelas.some((p) => p.status === 'OVERDUE')) {
        groupStatus = 'OVERDUE';
      } else if (parcelas.every((p) => p.status === 'CANCELED')) {
        groupStatus = 'CANCELED';
      }

      const payerName =
        plan.customer.payerType === 'RESPONSAVEL'
          ? responsavelMap.get(plan.customer.payerId) ?? parcelas[0]?.payerName ?? 'Cliente'
          : alunoMap.get(plan.customer.payerId) ?? parcelas[0]?.payerName ?? 'Cliente';

      const baseDescription = parcelas[0]?.description ?? 'Parcelamento';

      standaloneGroupItems.push({
        id: `group:standalone-installment:${planId}`,
        origin: 'STANDALONE',
        description: `Parcelamento ${plan.installmentCount}x - ${baseDescription}`,
        payerName,
        value: totalValue,
        dueDate: nextDue?.dueDate ?? parcelas[parcelas.length - 1]?.dueDate ?? plan.firstDueDate.toISOString(),
        billingType: plan.billingType,
        status: groupStatus,
        asaasStatus: null,
        liquidacaoStatus: null,
        displayStatus: resolveChargeDisplayStatus({ localStatus: groupStatus === 'PAID' ? 'PAGO' : groupStatus }),
        createdAt: plan.createdAt.toISOString(),
        sourceId: planId,
        matriculaId: null,
        alunoId: null,
        asaasPaymentId: null,
        tipo: 'PARCELADA',
        isGroup: true,
        groupType: 'INSTALLMENT',
        installmentPlanId: planId,
        installmentCount: plan.installmentCount,
        installmentsPaid: paidCount,
        installments: parcelas,
      });
    }

    // Combinar grupos + outros itens + standalone não-parceladas
    groupedAcademicCount = groupItems.length;
    groupedStandaloneCount = standaloneGroupItems.length;
    processedItems = [
      ...groupItems,
      ...standaloneGroupItems,
      ...otherItems,
      ...standaloneOtherItems,
      ...standaloneSubscriptionItems,
      ...eventItems,
    ];
  } else {
    // Sem agrupamento - retornar tudo individualmente
    processedItems = [...academicItems, ...standaloneItems, ...standaloneSubscriptionItems, ...eventItems];
  }

  processedItems = processedItems.filter((item) => matchesStatusView(item.status, statusView));

  // Ordenar por data de criação (mais recente primeiro)
  processedItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Aplicar paginação
  const skip = (page - 1) * pageSize;
  const paginatedItems = processedItems.slice(skip, skip + pageSize);

  // Calcular total corretamente (considerando agrupamento)
  const academicGroupCount = shouldGroup ? groupedAcademicCount : 0;
  const academicInstallmentItemsCount = shouldGroup
    ? academicItems.filter((i) => i.tipo === 'PARCELADA' && i.installmentPlanId).length
    : 0;
  const standaloneInstallmentItemsCount = shouldGroup
    ? standaloneItems.filter((i) => i.tipo === 'PARCELADA' && i.installmentPlanId).length
    : 0;
  const standaloneGroupCount = shouldGroup ? groupedStandaloneCount : 0;

  const adjustedTotal =
    academicCount +
    standaloneCount -
    academicInstallmentItemsCount -
    standaloneInstallmentItemsCount +
    academicGroupCount +
    standaloneGroupCount +
    standaloneSubscriptionItems.length +
    eventItems.length;

  const ungroupedTotal =
    academicCount + standaloneCount + standaloneSubscriptionItems.length + eventItems.length;

  return {
    items: paginatedItems,
    total: shouldGroup ? adjustedTotal : ungroupedTotal,
    page,
    pageSize,
    totalPages: Math.ceil((shouldGroup ? adjustedTotal : ungroupedTotal) / pageSize),
  };
}
