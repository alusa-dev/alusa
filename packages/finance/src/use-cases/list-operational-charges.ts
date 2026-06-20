import { prisma } from '@alusa/database';
import type { Prisma, PrismaClient } from '@prisma/client';

type FinanceDbClient = PrismaClient | Prisma.TransactionClient;
import type { UnifiedChargeItem, OperationalExposureReason } from '../dtos/unified-billing';
import {
  normalizeCobrancaStatus,
  normalizeChargeStatus,
  getEndOfCurrentMonth,
  getOperationalRecentSince,
} from '../dtos/unified-billing';
import { parseExternalReference } from '../core';
import { resolveChargeDisplayStatus, unifiedChargeStatusToLocal } from '../mappers/asaas-display-status';

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export type ListOperationalChargesInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  tipoFilter?: string[];
  /** "Agora" para testes (injeção de data). Default = new Date() */
  now?: Date;
};

export type ListOperationalChargesOutput = {
  items: UnifiedChargeItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type OperationalChargesSummaryOutput = {
  total: number;
  valorBruto: number;
};

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

// ---------------------------------------------------------------------------
// Helpers internos (copiados / refinados de list-charges-aggregated)
// ---------------------------------------------------------------------------

function mapBillingType(formaPagamento: string | null): string | null {
  if (!formaPagamento) return null;
  switch (formaPagamento) {
    case 'PIX': return 'PIX';
    case 'BOLETO': return 'BOLETO';
    case 'CARTAO_CREDITO': return 'CREDIT_CARD';
    case 'CARTAO_DEBITO': return 'DEBIT_CARD';
    case 'INDEFINIDO': return 'UNDEFINED';
    default: return formaPagamento;
  }
}

function extractInstallmentPlanId(externalReference: string | null): string | null {
  if (!externalReference) return null;
  const parsed = parseExternalReference(externalReference);
  if (parsed?.type === 'installment' && parsed.ids.installmentPlanId) return parsed.ids.installmentPlanId;
  if (parsed?.type === 'payment' && parsed.ids.installmentPlanId) return parsed.ids.installmentPlanId;
  if (!externalReference.startsWith('installmentPlan:')) return null;
  const rest = externalReference.slice('installmentPlan:'.length);
  if (rest.startsWith('pending:')) {
    return rest.slice('pending:'.length).split(':')[0] || null;
  }
  return rest.split(':')[0] || null;
}

function isGenericPayerName(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return !normalized || normalized === 'cliente' || normalized === 'needs_review';
}

function resolveStandaloneTipo(
  chargeType: 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION',
): 'AVULSA' | 'PARCELADA' | 'RECORRENTE' {
  if (chargeType === 'INSTALLMENT') return 'PARCELADA';
  if (chargeType === 'SUBSCRIPTION') return 'RECORRENTE';
  return 'AVULSA';
}

function extractSubscriptionKey(externalReference: string | null): string | null {
  if (!externalReference) return null;

  const isSubscriptionReference =
    externalReference.startsWith('subscription:') ||
    externalReference.startsWith('alusa:subscription:') ||
    externalReference.startsWith('alusa:standalone-subscription:');

  if (!isSubscriptionReference) return null;

  const paymentSeparator = ':payment:';
  const paymentIndex = externalReference.indexOf(paymentSeparator);
  if (paymentIndex === -1) return externalReference;
  return externalReference.slice(0, paymentIndex);
}

function inferAcademicChargeType(tipo: string | null): 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION' {
  if (tipo === 'PARCELADA') return 'INSTALLMENT';
  if (tipo === 'RECORRENTE' || tipo === 'MENSALIDADE') return 'SUBSCRIPTION';
  return 'ONE_TIME';
}

function inferStandaloneChargeType(params: {
  standaloneInstallmentPlanId: string | null;
  externalReference: string | null;
  standaloneSubscriptionId?: string | null;
}): 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION' {
  if (params.standaloneInstallmentPlanId || extractInstallmentPlanId(params.externalReference)) {
    return 'INSTALLMENT';
  }
  if (params.standaloneSubscriptionId) return 'SUBSCRIPTION';
  if (params.externalReference?.startsWith('alusa:standalone-subscription:')) return 'SUBSCRIPTION';
  return 'ONE_TIME';
}

function mapEventFinancialEntryStatus(status: string): UnifiedChargeItem['status'] {
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

function mapEventTicketSaleStatus(status: string): UnifiedChargeItem['status'] {
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

function mapEventMapOrderStatus(status: string): UnifiedChargeItem['status'] {
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

function buildItemDisplayStatus(input: {
  localStatus: string;
  asaasStatus?: string | null;
  liquidacaoStatus?: string | null;
  asaasPaymentId?: string | null;
}): NonNullable<UnifiedChargeItem['displayStatus']> {
  const resolved = resolveChargeDisplayStatus({
    localStatus: input.localStatus,
    asaasStatus: input.asaasStatus ?? null,
    liquidacaoStatus: input.liquidacaoStatus ?? null,
    hasAsaasLink: Boolean(input.asaasPaymentId),
  });

  return {
    status: resolved.status,
    label: resolved.label,
    hint: resolved.hint,
    variant: resolved.variant,
  };
}

function shouldExposeInOperationalQueue(params: {
  status: 'PENDING' | 'OVERDUE' | 'PAID' | 'PROCESSING' | 'CANCELED' | 'REFUNDED';
  dueDate: Date | null;
  isInstallment: boolean;
  now: Date;
}): boolean {
  if (!['PENDING', 'OVERDUE', 'PROCESSING'].includes(params.status)) return false;
  if (!params.dueDate) return true;

  const endOfMonth = getEndOfCurrentMonth(params.now);
  if (params.dueDate <= endOfMonth) return true;
  return false;
}

type OperationalItemMeta = UnifiedChargeItem & {
  _planId: string | null;
  _subscriptionKey: string | null;
};

const OPEN_STATUSES_FOR_RECENT_PIN: UnifiedChargeItem['status'][] = [
  'PENDING',
  'OVERDUE',
  'PROCESSING',
];

function isRecentlyCreatedCharge(createdAtIso: string, now: Date, recentSince: Date): boolean {
  const createdAt = new Date(createdAtIso).getTime();
  if (Number.isNaN(createdAt)) return false;
  return createdAt >= recentSince.getTime() && createdAt <= now.getTime();
}

function isDueAfterCurrentMonth(dueDate: Date | null, endOfMonth: Date): boolean {
  if (!dueDate) return false;
  return dueDate > endOfMonth;
}

function mergeRecordsById<T extends { id: string }>(primary: T[], supplemental: T[]): T[] {
  const seen = new Set(primary.map((item) => item.id));
  const merged = [...primary];
  for (const item of supplemental) {
    if (seen.has(item.id)) continue;
    merged.push(item);
    seen.add(item.id);
  }
  return merged;
}

function applyRecentlyCreatedPins(params: {
  allItems: OperationalItemMeta[];
  selectedIds: Set<string>;
  exposureReasonById: Map<string, OperationalExposureReason>;
  now: Date;
  endOfMonth: Date;
  recentSince: Date;
}): void {
  const { allItems, selectedIds, exposureReasonById, now, endOfMonth, recentSince } = params;

  const candidates = allItems.filter((item) => {
    if (selectedIds.has(item.id)) return false;
    if (!OPEN_STATUSES_FOR_RECENT_PIN.includes(item.status)) return false;
    if (!isRecentlyCreatedCharge(item.createdAt, now, recentSince)) return false;
    const dueDate = item.dueDate ? new Date(item.dueDate) : null;
    return isDueAfterCurrentMonth(dueDate, endOfMonth);
  });

  const subscriptionGroups = new Map<string, OperationalItemMeta[]>();
  for (const item of candidates) {
    if (!item._subscriptionKey) continue;
    const bucket = subscriptionGroups.get(item._subscriptionKey) ?? [];
    bucket.push(item);
    subscriptionGroups.set(item._subscriptionKey, bucket);
  }

  for (const [, groupItems] of subscriptionGroups) {
    groupItems.sort((a, b) => compareOperationalItems(a, b));
    const nextOpen = groupItems[0];
    if (!nextOpen) continue;
    selectedIds.add(nextOpen.id);
    exposureReasonById.set(nextOpen.id, 'RECENTLY_CREATED');
  }

  const installmentGroups = new Map<string, OperationalItemMeta[]>();
  for (const item of candidates) {
    if (!item._planId || item._subscriptionKey) continue;
    const bucket = installmentGroups.get(item._planId) ?? [];
    bucket.push(item);
    installmentGroups.set(item._planId, bucket);
  }

  for (const [, groupItems] of installmentGroups) {
    groupItems.sort((a, b) => compareOperationalItems(a, b));
    const firstOpen = groupItems[0];
    if (!firstOpen) continue;
    selectedIds.add(firstOpen.id);
    exposureReasonById.set(firstOpen.id, 'RECENTLY_CREATED');
  }

  for (const item of candidates) {
    if (item._planId || item._subscriptionKey) continue;
    if (selectedIds.has(item.id)) continue;
    selectedIds.add(item.id);
    exposureReasonById.set(item.id, 'RECENTLY_CREATED');
  }
}

function compareOperationalItems(
  a: Pick<UnifiedChargeItem, 'status' | 'dueDate' | 'createdAt'>,
  b: Pick<UnifiedChargeItem, 'status' | 'dueDate' | 'createdAt'>,
): number {
  if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
  if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;

  const aCreated = new Date(a.createdAt).getTime();
  const bCreated = new Date(b.createdAt).getTime();
  if (!Number.isNaN(aCreated) && !Number.isNaN(bCreated) && aCreated !== bCreated) {
    return bCreated - aCreated;
  }

  const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  return aDate - bDate;
}

// ---------------------------------------------------------------------------
// Use-case
// ---------------------------------------------------------------------------

/**
 * Lista cobranças na fila operacional: apenas itens que exigem atenção AGORA.
 *
 * Regras:
 * - Apenas status PENDING / OVERDUE
 * - Vencidas / mês corrente sempre entram
 * - Assinatura: sempre expor a próxima cobrança aberta gerada
 * - Avulsas recentes continuam entrando, sem despejar histórico futuro
 * - Parcelamentos: expor somente parcelas vencidas e a competência vigente
 *   (nunca despejar parcelas futuras)
 * - Pin temporário (72h): cobranças recém-geradas com vencimento futuro
 *   (avulsa, taxa, 1ª parcela, próxima assinatura) — badge RECENTLY_CREATED
 * - Ao quitar/pagar/cancelar: sai da lista
 */
async function buildOperationalChargesCollection(
  input: ListOperationalChargesInput,
  db?: FinanceDbClient,
): Promise<UnifiedChargeItem[]> {
  const _db = db ?? prisma;
  const { contaId, search, tipoFilter } = input;
  const now = input.now ?? new Date();
  const endOfMonth = getEndOfCurrentMonth(now);
  const recentSince = getOperationalRecentSince(now);

  const openAcademicStatuses = ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO'] as const;
  const openStandaloneStatuses = ['CREATED', 'OPEN', 'OVERDUE', 'PENDING_SYNC'] as const;

  // =================================================================
  // 1. Cobranças acadêmicas operacionais
  // =================================================================
  const academicWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: { in: [...openAcademicStatuses] } },
      {
        OR: [
          { vencimento: { lte: endOfMonth } },
        ],
      },
    ],
  };

  const academicRecentWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: { in: [...openAcademicStatuses] } },
      { vencimento: { gt: endOfMonth } },
      { createdAt: { gte: recentSince } },
    ],
  };

  if (tipoFilter?.length) {
    (academicWhere.AND as unknown[]).push({ tipo: { in: tipoFilter } });
    (academicRecentWhere.AND as unknown[]).push({ tipo: { in: tipoFilter } });
  }

  if (search) {
    const searchCondition = {
      OR: [
      { matricula: { aluno: { nome: { contains: search, mode: 'insensitive' } } } },
      { descricao: { contains: search, mode: 'insensitive' } },
      ],
    };
    (academicWhere.AND as unknown[]).push(searchCondition);
    (academicRecentWhere.AND as unknown[]).push(searchCondition);
  }

  // =================================================================
  // 2. Cobranças standalone operacionais
  // =================================================================
  const standaloneWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { cobrancaId: null },
      { status: { in: [...openStandaloneStatuses] } },
      {
        NOT: [
          { externalReference: { contains: ':needs-review:' } },
          { payerName: 'NEEDS_REVIEW' },
        ],
      },
      {
        OR: [
          { dueDate: { lte: endOfMonth } },
          { dueDate: null },
        ],
      },
    ],
  };

  const standaloneRecentWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { cobrancaId: null },
      { status: { in: [...openStandaloneStatuses] } },
      {
        NOT: [
          { externalReference: { contains: ':needs-review:' } },
          { payerName: 'NEEDS_REVIEW' },
        ],
      },
      { dueDate: { gt: endOfMonth } },
      { createdAt: { gte: recentSince } },
    ],
  };

  if (search) {
    (standaloneWhere.AND as unknown[]).push({
      OR: [
        { payerName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    });
    (standaloneRecentWhere.AND as unknown[]).push({
      OR: [
        { payerName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  const standaloneSubscriptionWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: { in: ['REQUESTED', 'ACTIVE'] } },
      { nextDueDate: { lte: endOfMonth } },
    ],
  };

  const standaloneSubscriptionRecentWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: { in: ['REQUESTED', 'ACTIVE'] } },
      { nextDueDate: { gt: endOfMonth } },
      { createdAt: { gte: recentSince } },
    ],
  };

  if (search) {
    (standaloneSubscriptionWhere.AND as unknown[]).push({
      OR: [
        { description: { contains: search, mode: 'insensitive' } },
        { customer: { is: { payerId: { contains: search, mode: 'insensitive' } } } },
      ],
    });
    (standaloneSubscriptionRecentWhere.AND as unknown[]).push({
      OR: [
        { description: { contains: search, mode: 'insensitive' } },
        { customer: { is: { payerId: { contains: search, mode: 'insensitive' } } } },
      ],
    });
  }

  const eventFinancialEntryWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { type: 'REVENUE' },
      { status: { in: ['EXPECTED', 'PENDING'] } },
      { NOT: { originType: 'TICKET_SALE' } },
      {
        OR: [
          { dueDate: { lte: endOfMonth } },
          { dueDate: null },
        ],
      },
    ],
  };

  const eventFinancialEntryRecentWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { type: 'REVENUE' },
      { status: { in: ['EXPECTED', 'PENDING'] } },
      { NOT: { originType: 'TICKET_SALE' } },
      { dueDate: { gt: endOfMonth } },
      { createdAt: { gte: recentSince } },
    ],
  };

  if (search) {
    (eventFinancialEntryWhere.AND as unknown[]).push({
      OR: [
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    });
    (eventFinancialEntryRecentWhere.AND as unknown[]).push({
      OR: [
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    });
  }

  const eventTicketSaleWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: 'PENDING' },
    ],
  };

  if (search) {
    (eventTicketSaleWhere.AND as unknown[]).push({
      OR: [
        { buyerName: { contains: search, mode: 'insensitive' } },
        { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    });
  }

  const eventMapOrderWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: 'PAYMENT_PENDING' },
      {
        OR: [
          { expiresAt: { lte: endOfMonth } },
          { expiresAt: null },
        ],
      },
    ],
  };

  const eventMapOrderRecentWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { status: 'PAYMENT_PENDING' },
      { expiresAt: { gt: endOfMonth } },
      { createdAt: { gte: recentSince } },
    ],
  };

  if (search) {
    (eventMapOrderWhere.AND as unknown[]).push({
      OR: [
        { buyerName: { contains: search, mode: 'insensitive' } },
        { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    });
    (eventMapOrderRecentWhere.AND as unknown[]).push({
      OR: [
        { buyerName: { contains: search, mode: 'insensitive' } },
        { event: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    });
  }

  const academicInclude = {
    matricula: {
      select: {
        id: true,
        aluno: { select: { id: true, nome: true } },
        responsavelFinanceiro: { select: { nome: true } },
        billingMode: true,
        matriculaFamiliarId: true,
      },
    },
  } as const;

  const standaloneChargeSelect = {
    id: true, contaId: true, externalReference: true, status: true,
    asaasPaymentId: true, asaasStatus: true, liquidacaoStatus: true,
    createdAt: true, payerName: true,
    description: true, value: true, dueDate: true, billingType: true,
    standaloneInstallmentPlanId: true, standaloneSubscriptionId: true, familyGroupId: true, invoiceUrl: true,
    customer: {
      select: {
        payerType: true,
        payerId: true,
      },
    },
  } as const;

  const standaloneSubscriptionSelect = {
    id: true,
    status: true,
    customerId: true,
    asaasSubscriptionId: true,
    cycle: true,
    billingType: true,
    value: true,
    nextDueDate: true,
    description: true,
    familyGroupId: true,
    createdAt: true,
    customer: { select: { payerType: true, payerId: true } },
  } as const;

  // =================================================================
  // 3. Cobranças acadêmicas (operacionais + recém-geradas futuras)
  // =================================================================
  const [academicResultMain, academicResultRecent] = await Promise.all([
    _db.cobranca.findMany({
      where: academicWhere,
      orderBy: { vencimento: 'asc' },
      include: academicInclude,
    }),
    _db.cobranca.findMany({
      where: academicRecentWhere,
      orderBy: { vencimento: 'asc' },
      include: academicInclude,
    }),
  ]);

  const academicResult = mergeRecordsById(academicResultMain, academicResultRecent);
  const academicCobrancaIds = academicResult.map((cobranca) => cobranca.id);

  // =================================================================
  // 4. Demais fontes em paralelo (charges vinculadas só das acadêmicas abertas)
  // =================================================================
  const [
    standaloneResultMain,
    standaloneResultRecent,
    linkedCharges,
    standaloneSubscriptionsMain,
    standaloneSubscriptionsRecent,
    eventFinancialEntriesMain,
    eventFinancialEntriesRecent,
    eventTicketSales,
    eventMapOrdersMain,
    eventMapOrdersRecent,
  ] = await Promise.all([
    _db.charge.findMany({
      where: standaloneWhere,
      orderBy: { dueDate: 'asc' },
      select: standaloneChargeSelect,
    }),
    _db.charge.findMany({
      where: standaloneRecentWhere,
      orderBy: { dueDate: 'asc' },
      select: standaloneChargeSelect,
    }),
    academicCobrancaIds.length
      ? _db.charge.findMany({
          where: {
            contaId,
            cobrancaId: { in: academicCobrancaIds },
            OR: [
              { externalReference: { startsWith: 'installmentPlan:' } },
              { externalReference: { startsWith: 'alusa:installment:' } },
              { externalReference: { startsWith: 'subscription:' } },
              { externalReference: { startsWith: 'alusa:subscription:' } },
            ],
          },
          select: { cobrancaId: true, externalReference: true },
        })
      : Promise.resolve([]),
    _db.standaloneSubscription.findMany({
      where: standaloneSubscriptionWhere,
      orderBy: { nextDueDate: 'asc' },
      select: standaloneSubscriptionSelect,
    }),
    _db.standaloneSubscription.findMany({
      where: standaloneSubscriptionRecentWhere,
      orderBy: { nextDueDate: 'asc' },
      select: standaloneSubscriptionSelect,
    }),
    _db.eventFinancialEntry.findMany({
      where: eventFinancialEntryWhere,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        eventId: true,
        category: true,
        description: true,
        expectedAmount: true,
        dueDate: true,
        status: true,
        paymentMethod: true,
        asaasPaymentId: true,
        createdAt: true,
        event: { select: { name: true } },
      },
    }),
    _db.eventFinancialEntry.findMany({
      where: eventFinancialEntryRecentWhere,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        eventId: true,
        category: true,
        description: true,
        expectedAmount: true,
        dueDate: true,
        status: true,
        paymentMethod: true,
        asaasPaymentId: true,
        createdAt: true,
        event: { select: { name: true } },
      },
    }),
    _db.eventTicketSale.findMany({
      where: eventTicketSaleWhere,
      orderBy: [{ soldAt: 'desc' }],
      select: {
        id: true,
        eventId: true,
        buyerName: true,
        alunoId: true,
        responsavelId: true,
        quantity: true,
        totalAmount: true,
        paymentMethod: true,
        status: true,
        soldAt: true,
        asaasPaymentId: true,
        revenueEntryId: true,
        event: { select: { name: true } },
      },
    }),
    _db.eventMapOrder.findMany({
      where: eventMapOrderWhere,
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
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
    _db.eventMapOrder.findMany({
      where: eventMapOrderRecentWhere,
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
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

  const standaloneResult = mergeRecordsById(standaloneResultMain, standaloneResultRecent);
  const standaloneSubscriptions = mergeRecordsById(
    standaloneSubscriptionsMain,
    standaloneSubscriptionsRecent,
  );
  const eventFinancialEntries = mergeRecordsById(
    eventFinancialEntriesMain,
    eventFinancialEntriesRecent,
  );
  const eventMapOrders = mergeRecordsById(eventMapOrdersMain, eventMapOrdersRecent);

  // Mapa cobrancaId → installmentPlanId
  const cobrancaToInstallmentPlan = new Map<string, string>();
  const cobrancaToSubscriptionKey = new Map<string, string>();
  for (const charge of linkedCharges) {
    if (charge.cobrancaId) {
      const planId = extractInstallmentPlanId(charge.externalReference);
      if (planId) cobrancaToInstallmentPlan.set(charge.cobrancaId, planId);
      const subscriptionKey = extractSubscriptionKey(charge.externalReference);
      if (subscriptionKey) cobrancaToSubscriptionKey.set(charge.cobrancaId, subscriptionKey);
    }
  }

  const effectiveStandaloneResult = standaloneResult.filter((charge) => {
    if (!['CREATED', 'OPEN', 'OVERDUE', 'PENDING_SYNC'].includes(charge.status)) return false;
    if (!tipoFilter?.length) return true;
    const chargeType = inferStandaloneChargeType({
      standaloneInstallmentPlanId: charge.standaloneInstallmentPlanId,
      externalReference: charge.externalReference,
    });
    return tipoFilter.includes(resolveStandaloneTipo(chargeType));
  });

  const standaloneAlunoIds = Array.from(
    new Set(
      [
        ...effectiveStandaloneResult
          .filter(
            (charge) =>
              isGenericPayerName(charge.payerName) &&
              charge.customer?.payerType === 'ALUNO' &&
              typeof charge.customer.payerId === 'string',
          )
          .map((charge) => charge.customer!.payerId),
        ...standaloneSubscriptions
          .filter((subscription) => subscription.customer?.payerType === 'ALUNO')
          .map((subscription) => subscription.customer.payerId),
      ],
    ),
  );

  const standaloneResponsavelIds = Array.from(
    new Set(
      [
        ...effectiveStandaloneResult
          .filter(
            (charge) =>
              isGenericPayerName(charge.payerName) &&
              charge.customer?.payerType === 'RESPONSAVEL' &&
              typeof charge.customer.payerId === 'string',
          )
          .map((charge) => charge.customer!.payerId),
        ...standaloneSubscriptions
          .filter((subscription) => subscription.customer?.payerType === 'RESPONSAVEL')
          .map((subscription) => subscription.customer.payerId),
      ],
    ),
  );

  const [standaloneAlunos, standaloneResponsaveis] = await Promise.all([
    standaloneAlunoIds.length
      ? _db.aluno.findMany({
          where: { id: { in: standaloneAlunoIds } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
    standaloneResponsavelIds.length
      ? _db.responsavel.findMany({
          where: { id: { in: standaloneResponsavelIds } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
  ]);

  const standalonePayerNameByKey = new Map<string, string>();
  for (const aluno of standaloneAlunos) {
    standalonePayerNameByKey.set(`ALUNO:${aluno.id}`, aluno.nome);
  }
  for (const responsavel of standaloneResponsaveis) {
    standalonePayerNameByKey.set(`RESPONSAVEL:${responsavel.id}`, responsavel.nome);
  }

  // =================================================================
  // 4. Normalizar para UnifiedChargeItem
  // =================================================================
  const academicItems: (UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null })[] = academicResult
    .map<UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null }>((c) => ({
      id: c.id,
      origin: 'ACADEMIC' as const,
      description: c.descricao || c.tipo,
      payerName: c.matricula.responsavelFinanceiro?.nome ?? c.matricula.aluno.nome,
      value: Number(c.valor),
      dueDate: c.vencimento?.toISOString() ?? null,
      billingType: mapBillingType(c.formaPagamento),
      status: normalizeCobrancaStatus(c.status),
      asaasStatus: c.asaasStatus,
      liquidacaoStatus: c.liquidacaoStatus,
      displayStatus: buildItemDisplayStatus({
        localStatus: c.status,
        asaasStatus: c.asaasStatus,
        liquidacaoStatus: c.liquidacaoStatus,
        asaasPaymentId: c.asaasPaymentId,
      }),
      chargeType: inferAcademicChargeType(c.tipo),
      linkStatus: c.asaasPaymentId ? ('LINKED' as const) : ('NEEDS_REVIEW' as const),
      asaasPaymentId: c.asaasPaymentId,
      tipo: c.tipo,
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      matriculaId: c.matriculaId,
      alunoId: c.matricula.aluno.id,
      isGroup: false,
      groupType: null,
      groupId: null,
      installmentCount: null,
      installmentsPaid: null,
      _planId: cobrancaToInstallmentPlan.get(c.id) ?? null,
      _subscriptionKey: cobrancaToSubscriptionKey.get(c.id) ?? null,
    }));

  const standaloneItems: (UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null })[] = effectiveStandaloneResult.map<UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null }>((c) => {
    const chargeType = inferStandaloneChargeType({
      standaloneInstallmentPlanId: c.standaloneInstallmentPlanId,
      externalReference: c.externalReference,
      standaloneSubscriptionId: c.standaloneSubscriptionId,
    });
    const resolvedPlanId = c.standaloneInstallmentPlanId ?? extractInstallmentPlanId(c.externalReference);
    const resolvedPayerName = c.customer
      ? standalonePayerNameByKey.get(`${c.customer.payerType}:${c.customer.payerId}`) ?? null
      : null;

    return {
      id: c.id,
      origin: 'STANDALONE' as const,
      description:
        c.description ??
        (chargeType === 'SUBSCRIPTION'
          ? 'Assinatura recorrente'
          : chargeType === 'INSTALLMENT'
            ? 'Parcela'
            : 'Cobrança avulsa'),
      payerName:
        !isGenericPayerName(c.payerName)
          ? (c.payerName as string)
          : (resolvedPayerName ?? c.payerName ?? 'Cliente'),
      value: c.value != null ? Number(c.value) : 0,
      dueDate: c.dueDate?.toISOString() ?? null,
      billingType: c.billingType,
      status: normalizeChargeStatus(c.status),
      asaasStatus: c.asaasStatus,
      liquidacaoStatus: c.liquidacaoStatus,
      displayStatus: buildItemDisplayStatus({
        localStatus: c.status,
        asaasStatus: c.asaasStatus,
        liquidacaoStatus: c.liquidacaoStatus,
        asaasPaymentId: c.asaasPaymentId,
      }),
      chargeType,
      linkStatus: c.asaasPaymentId ? ('LINKED' as const) : ('NEEDS_REVIEW' as const),
      asaasPaymentId: c.asaasPaymentId,
      invoiceUrl: c.invoiceUrl ?? null,
      tipo: resolveStandaloneTipo(chargeType),
      createdAt: c.createdAt?.toISOString() ?? new Date().toISOString(),
      matriculaId: null,
      alunoId: null,
      isGroup: false,
      groupType: null,
      groupId: null,
      installmentCount: null,
      installmentsPaid: null,
      _planId: resolvedPlanId,
      _subscriptionKey: extractSubscriptionKey(c.externalReference),
    };
  });

  const materializedSubscriptionIds = new Set(
    effectiveStandaloneResult
      .map((charge) => charge.standaloneSubscriptionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const standaloneSubscriptionItems: (UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null })[] =
    standaloneSubscriptions
      .filter((subscription) => {
        if (tipoFilter?.length && !tipoFilter.includes('RECORRENTE')) return false;
        return !materializedSubscriptionIds.has(subscription.id);
      })
      .map((subscription) => {
        const resolvedPayerName = subscription.customer
          ? standalonePayerNameByKey.get(`${subscription.customer.payerType}:${subscription.customer.payerId}`)
          : null;

        return {
          id: `group:subscription:${subscription.id}`,
          origin: 'STANDALONE' as const,
          description: subscription.description ?? 'Assinatura recorrente',
          payerName: resolvedPayerName ?? 'Cliente',
          value: Number(subscription.value),
          dueDate: subscription.nextDueDate.toISOString(),
          billingType: subscription.billingType,
          status: 'PENDING',
          asaasStatus: null,
          liquidacaoStatus: null,
          displayStatus: buildItemDisplayStatus({
            localStatus: 'PENDENTE',
            asaasPaymentId: null,
          }),
          chargeType: 'SUBSCRIPTION',
          linkStatus: subscription.asaasSubscriptionId ? ('LINKED' as const) : ('NEEDS_REVIEW' as const),
          asaasPaymentId: null,
          tipo: 'RECORRENTE',
          createdAt: subscription.createdAt.toISOString(),
          matriculaId: null,
          alunoId: subscription.customer?.payerType === 'ALUNO' ? subscription.customer.payerId : null,
          isGroup: true,
          groupType: 'SUBSCRIPTION',
          groupId: subscription.id,
          installmentCount: null,
          installmentsPaid: null,
          _planId: null,
          _subscriptionKey: subscription.id,
        };
      });

  const eventItems: (UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null })[] = [
    ...eventFinancialEntries.map((entry) => {
      const unifiedStatus = mapEventFinancialEntryStatus(entry.status);
      return {
      id: `event-entry:${entry.id}`,
      origin: 'EVENT' as const,
      description: `${entry.event.name} · ${entry.description || entry.category}`,
      payerName: entry.event.name,
      value: Number(entry.expectedAmount),
      dueDate: entry.dueDate?.toISOString() ?? null,
      billingType: entry.paymentMethod,
      status: unifiedStatus,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: buildItemDisplayStatus({
        localStatus: unifiedChargeStatusToLocal(unifiedStatus),
        asaasPaymentId: entry.asaasPaymentId,
      }),
      chargeType: 'ONE_TIME' as const,
      linkStatus: entry.asaasPaymentId ? ('LINKED' as const) : ('NEEDS_REVIEW' as const),
      asaasPaymentId: entry.asaasPaymentId,
      tipo: 'EVENTO',
      createdAt: entry.createdAt.toISOString(),
      matriculaId: null,
      alunoId: null,
      eventId: entry.eventId,
      isGroup: false,
      groupType: null,
      groupId: null,
      installmentCount: null,
      installmentsPaid: null,
      _planId: null,
      _subscriptionKey: null,
    };
    }),
    ...eventTicketSales.map((sale) => {
      const unifiedStatus = mapEventTicketSaleStatus(sale.status);
      return {
      id: `event-ticket-sale:${sale.id}`,
      origin: 'EVENT' as const,
      description: `${sale.event.name} · ${sale.quantity} ingresso(s)`,
      payerName: sale.buyerName,
      value: Number(sale.totalAmount),
      dueDate: sale.soldAt.toISOString(),
      billingType: sale.paymentMethod,
      status: unifiedStatus,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: buildItemDisplayStatus({
        localStatus: unifiedChargeStatusToLocal(unifiedStatus),
        asaasPaymentId: sale.asaasPaymentId,
      }),
      chargeType: 'ONE_TIME' as const,
      linkStatus: sale.asaasPaymentId ? ('LINKED' as const) : ('NEEDS_REVIEW' as const),
      asaasPaymentId: sale.asaasPaymentId,
      tipo: 'EVENTO',
      createdAt: sale.soldAt.toISOString(),
      matriculaId: null,
      alunoId: sale.alunoId,
      eventId: sale.eventId,
      isGroup: false,
      groupType: null,
      groupId: null,
      installmentCount: null,
      installmentsPaid: null,
      _planId: null,
      _subscriptionKey: null,
    };
    }),
    ...eventMapOrders.map((order) => {
      const unifiedStatus = mapEventMapOrderStatus(order.status);
      return {
      id: `event-map-order:${order.id}`,
      origin: 'EVENT' as const,
      description: `${order.event.name} · Pedido de ingresso`,
      payerName: order.buyerName,
      value: Number(order.totalAmount),
      dueDate: order.expiresAt?.toISOString() ?? null,
      billingType: order.paymentMethod ?? order.paymentProvider,
      status: unifiedStatus,
      asaasStatus: null,
      liquidacaoStatus: null,
      displayStatus: buildItemDisplayStatus({
        localStatus: unifiedChargeStatusToLocal(unifiedStatus),
        asaasPaymentId: order.asaasPaymentId,
      }),
      chargeType: 'ONE_TIME' as const,
      linkStatus: order.asaasPaymentId ? ('LINKED' as const) : ('NEEDS_REVIEW' as const),
      asaasPaymentId: order.asaasPaymentId,
      invoiceUrl: order.invoiceUrl,
      tipo: 'EVENTO',
      createdAt: order.createdAt.toISOString(),
      matriculaId: null,
      alunoId: null,
      eventId: order.eventId,
      isGroup: false,
      groupType: null,
      groupId: null,
      installmentCount: null,
      installmentsPaid: null,
      _planId: null,
      _subscriptionKey: null,
    };
    }),
  ].filter((item) => !tipoFilter?.length || tipoFilter.includes(item.tipo ?? ''));

  // =================================================================
  // 5. Expor apenas itens operacionais relevantes
  // =================================================================
  const allItemsWithMeta = [
    ...academicItems,
    ...standaloneItems,
    ...standaloneSubscriptionItems,
    ...eventItems,
  ];
  const selectedIds = new Set<string>();
  const exposureReasonById = new Map<string, OperationalExposureReason>();

  const markOperational = (id: string) => {
    selectedIds.add(id);
    exposureReasonById.set(id, 'OPERATIONAL');
  };

  const allOverdue = allItemsWithMeta.filter((item) => item.status === 'OVERDUE');
  for (const item of allOverdue) markOperational(item.id);

  const subscriptionGroups = new Map<string, OperationalItemMeta[]>();
  for (const item of allItemsWithMeta) {
    if (!item._subscriptionKey || !['PENDING', 'PROCESSING'].includes(item.status)) continue;
    const itemDueDate = item.dueDate ? new Date(item.dueDate) : null;
    if (itemDueDate && itemDueDate > endOfMonth) continue;
    const bucket = subscriptionGroups.get(item._subscriptionKey) ?? [];
    bucket.push(item);
    subscriptionGroups.set(item._subscriptionKey, bucket);
  }

  for (const [, groupItems] of subscriptionGroups) {
    groupItems.sort(compareOperationalItems);
    const nextOpen = groupItems[0];
    if (nextOpen) markOperational(nextOpen.id);
  }

  for (const item of allItemsWithMeta) {
    if (selectedIds.has(item.id)) continue;

    const itemDueDate = item.dueDate ? new Date(item.dueDate) : null;

    if (item._planId) {
      if (['PENDING', 'PROCESSING'].includes(item.status) && (!itemDueDate || itemDueDate <= endOfMonth)) {
        markOperational(item.id);
      }
      continue;
    }

    if (item._subscriptionKey) continue;

    if (shouldExposeInOperationalQueue({
      status: item.status,
      dueDate: itemDueDate,
      isInstallment: false,
      now,
    })) {
      markOperational(item.id);
    }
  }

  applyRecentlyCreatedPins({
    allItems: allItemsWithMeta,
    selectedIds,
    exposureReasonById,
    now,
    endOfMonth,
    recentSince,
  });

  const allItems: UnifiedChargeItem[] = allItemsWithMeta
    .filter((item) => selectedIds.has(item.id))
    .map((item) => {
      const { _planId, _subscriptionKey, ...clean } = item;
      return {
        ...clean,
        exposureReason: exposureReasonById.get(item.id) ?? 'OPERATIONAL',
      };
    });

  // Ordenar: overdue primeiro, depois por criação DESC (mais recentes no topo)
  allItems.sort(compareOperationalItems);

  return allItems;
}

export async function getOperationalChargesSummary(
  input: ListOperationalChargesInput,
  db?: FinanceDbClient,
): Promise<OperationalChargesSummaryOutput> {
  const items = await buildOperationalChargesCollection(input, db);

  return {
    total: items.length,
    valorBruto: roundCurrency(items.reduce((sum, item) => sum + Number(item.value ?? 0), 0)),
  };
}

export async function listOperationalCharges(
  input: ListOperationalChargesInput,
  db?: FinanceDbClient,
): Promise<ListOperationalChargesOutput> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const allItems = await buildOperationalChargesCollection(input, db);

  const total = allItems.length;
  const skip = (page - 1) * pageSize;
  const paginatedItems = allItems.slice(skip, skip + pageSize);

  return {
    items: paginatedItems,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
