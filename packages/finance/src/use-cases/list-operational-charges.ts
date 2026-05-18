import { prisma } from '@alusa/database';
import type { UnifiedChargeItem } from '../dtos/unified-billing';
import {
  normalizeCobrancaStatus,
  normalizeChargeStatus,
  getEndOfCurrentMonth,
} from '../dtos/unified-billing';
import { parseExternalReference } from '../core';
import { mapAsaasPaymentStatusToCharge } from '../mappers';
import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { getPayment, isAsaasEnabled, listPayments } from './asaas-ops';
import { reconcileAcademicChargesWithAsaas } from './reconcile-academic-charges';

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
}): 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION' {
  if (params.standaloneInstallmentPlanId || extractInstallmentPlanId(params.externalReference)) {
    return 'INSTALLMENT';
  }
  if (params.externalReference?.startsWith('alusa:standalone-subscription:')) return 'SUBSCRIPTION';
  return 'ONE_TIME';
}

function parseAsaasDueDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T12:00:00.000Z`);
}

function formatAsaasDate(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, '0');
  const day = String(input.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAsaasErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown };
  return typeof candidate.status === 'number' ? candidate.status : null;
}

const STANDALONE_REMOTE_RECONCILE_WINDOW_MS = 5 * 60_000;
const REMOTE_PAYMENT_PAGE_SIZE = 100;
const REMOTE_PAYMENT_MAX_PAGES_PER_STATUS = 20;
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

function compareOperationalItems(a: Pick<UnifiedChargeItem, 'status' | 'dueDate'>, b: Pick<UnifiedChargeItem, 'status' | 'dueDate'>): number {
  if (a.status === 'OVERDUE' && b.status !== 'OVERDUE') return -1;
  if (b.status === 'OVERDUE' && a.status !== 'OVERDUE') return 1;

  const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  return aDate - bDate;
}

function shouldReconcileStandaloneCharge(params: {
  asaasPaymentId: string | null;
  dueDate: Date | null;
  status: string;
  updatedAt?: Date | null;
  statusUpdatedAt?: Date | null;
  createdAt?: Date | null;
  now: Date;
}): boolean {
  if (!params.asaasPaymentId) return false;
  if (!params.dueDate) return true;
  if (params.status === 'CREATED' || params.status === 'PAID') return true;

  const freshnessAnchor = params.updatedAt ?? params.statusUpdatedAt ?? params.createdAt ?? null;
  if (!freshnessAnchor) return true;

  return params.now.getTime() - freshnessAnchor.getTime() < STANDALONE_REMOTE_RECONCILE_WINDOW_MS;
}

function inferRemotePaymentType(payment: {
  subscription?: string | null;
  installment?: string | null;
  externalReference?: string | null;
}): 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION' {
  if (payment.installment || extractInstallmentPlanId(payment.externalReference ?? null)) {
    return 'INSTALLMENT';
  }
  if (
    payment.subscription ||
    payment.externalReference?.startsWith('subscription:') ||
    payment.externalReference?.startsWith('alusa:subscription:') ||
    payment.externalReference?.startsWith('alusa:standalone-subscription:')
  ) {
    return 'SUBSCRIPTION';
  }
  return 'ONE_TIME';
}

function mapRemoteStatusToUnified(status: string): UnifiedChargeItem['status'] | null {
  switch (status) {
    case 'PENDING':
      return 'PENDING';
    case 'AWAITING_RISK_ANALYSIS':
      return 'PROCESSING';
    case 'OVERDUE':
    case 'DUNNING_REQUESTED':
      return 'OVERDUE';
    default:
      return null;
  }
}

async function listRemoteOperationalPaymentItems(params: {
  contaId: string;
  endOfMonth: Date;
  tipoFilter?: string[];
  search?: string;
}): Promise<UnifiedChargeItem[]> {
  if (!isAsaasEnabled()) return [];

  const statuses = ['PENDING', 'AWAITING_RISK_ANALYSIS', 'OVERDUE', 'DUNNING_REQUESTED'] as const;
  const endDate = formatAsaasDate(params.endOfMonth);
  const responses = await Promise.allSettled(
    statuses.map(async (status) => {
      const data: Awaited<ReturnType<typeof listPayments>>['data'] = [];
      let offset = 0;
      let hasMore = true;
      let pageCount = 0;

      while (hasMore && pageCount < REMOTE_PAYMENT_MAX_PAGES_PER_STATUS) {
        const page = await listPayments(
          {
            status,
            'dueDate[le]': endDate,
            limit: REMOTE_PAYMENT_PAGE_SIZE,
            offset,
          },
          { contaId: params.contaId },
        );
        data.push(...(page.data ?? []));
        hasMore = Boolean(page.hasMore);
        offset += REMOTE_PAYMENT_PAGE_SIZE;
        pageCount += 1;
      }

      return data;
    }),
  );

  const items: UnifiedChargeItem[] = [];
  for (const response of responses) {
    if (response.status !== 'fulfilled') {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[finance][listOperationalCharges] Falha ao listar payments Asaas', {
          contaId: params.contaId,
          error: response.reason instanceof Error ? response.reason.message : String(response.reason),
        });
      }
      continue;
    }

    for (const payment of response.value) {
      const status = mapRemoteStatusToUnified(payment.status);
      if (!status) continue;

      const chargeType = inferRemotePaymentType(payment);
      const tipo = resolveStandaloneTipo(chargeType);
      if (params.tipoFilter?.length && !params.tipoFilter.includes(tipo)) continue;

      const description =
        payment.description ??
        (chargeType === 'SUBSCRIPTION'
          ? 'Assinatura recorrente'
          : chargeType === 'INSTALLMENT'
            ? 'Parcela'
            : 'Cobrança avulsa');
      if (params.search) {
        const q = params.search.toLowerCase();
        const haystack = `${description} ${payment.id} ${payment.externalReference ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }

      items.push({
        id: `asaas:${payment.id}`,
        origin: 'STANDALONE',
        description,
        payerName: 'Cliente',
        value: Number(payment.value ?? 0),
        dueDate: parseAsaasDueDate(payment.dueDate)?.toISOString() ?? null,
        billingType: payment.billingType ?? null,
        status,
        chargeType,
        linkStatus: 'NEEDS_REVIEW',
        asaasPaymentId: payment.id,
        invoiceUrl: payment.invoiceUrl ?? null,
        bankSlipUrl: payment.bankSlipUrl ?? null,
        tipo,
        createdAt: parseAsaasDueDate(payment.dateCreated)?.toISOString() ?? new Date().toISOString(),
        matriculaId: null,
        alunoId: null,
        isGroup: false,
        groupType: null,
        groupId: null,
        installmentCount: null,
        installmentsPaid: null,
      });
    }
  }

  return items;
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
 * - Ao quitar/pagar/cancelar: sai da lista
 */
async function buildOperationalChargesCollection(
  input: ListOperationalChargesInput,
  db?: typeof prisma,
): Promise<UnifiedChargeItem[]> {
  const _db = db ?? prisma;
  const { contaId, search, tipoFilter } = input;
  const now = input.now ?? new Date();
  const endOfMonth = getEndOfCurrentMonth(now);

  // =================================================================
  // 1. Cobranças acadêmicas operacionais
  // =================================================================
  const academicWhere: Record<string, unknown> = {
    AND: [
      { matricula: { aluno: { contaId } } },
      { status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO'] } },
      {
        OR: [
          { vencimento: { lte: endOfMonth } },
        ],
      },
    ],
  };

  if (tipoFilter?.length) {
    (academicWhere.AND as unknown[]).push({ tipo: { in: tipoFilter } });
  }

  if (search) {
    const searchCondition = {
      OR: [
      { matricula: { aluno: { nome: { contains: search, mode: 'insensitive' } } } },
      { descricao: { contains: search, mode: 'insensitive' } },
      ],
    };
    (academicWhere.AND as unknown[]).push(searchCondition);
  }

  // =================================================================
  // 2. Cobranças standalone operacionais
  // =================================================================
  const standaloneWhere: Record<string, unknown> = {
    AND: [
      { contaId },
      { cobrancaId: null },
      { status: { in: ['CREATED', 'OPEN', 'OVERDUE', 'PAID', 'PENDING_SYNC'] } },
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

  if (search) {
    (standaloneWhere.AND as unknown[]).push({
      OR: [
        { payerName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  // =================================================================
  // 3. Executar queries em paralelo
  // =================================================================
  const [academicResultRaw, standaloneResult, linkedCharges] = await Promise.all([
    _db.cobranca.findMany({
      where: academicWhere,
      orderBy: { vencimento: 'asc' },
      include: {
        matricula: {
          select: {
            id: true,
            aluno: { select: { id: true, nome: true } },
            responsavelFinanceiro: { select: { nome: true } },
            billingMode: true,
            matriculaFamiliarId: true,
          },
        },
      },
    }),
    _db.charge.findMany({
      where: standaloneWhere,
      orderBy: { dueDate: 'asc' },
      select: {
        id: true, contaId: true, externalReference: true, status: true,
        asaasPaymentId: true, createdAt: true, updatedAt: true, statusUpdatedAt: true, payerName: true,
        description: true, value: true, dueDate: true, billingType: true,
        standaloneInstallmentPlanId: true, standaloneSubscriptionId: true, familyGroupId: true, invoiceUrl: true,
        customer: {
          select: {
            payerType: true,
            payerId: true,
          },
        },
      },
    }),
    // Charges acadêmicas vinculadas a mensalidades/parcelamentos
    _db.charge.findMany({
      where: {
        contaId,
        cobrancaId: { not: null },
        OR: [
          { externalReference: { startsWith: 'installmentPlan:' } },
          { externalReference: { startsWith: 'alusa:installment:' } },
          { externalReference: { startsWith: 'subscription:' } },
          { externalReference: { startsWith: 'alusa:subscription:' } },
        ],
      },
      select: { cobrancaId: true, externalReference: true, status: true },
    }),
  ]);

  const academicReconciliation =
    isAsaasEnabled() && academicResultRaw.length
      ? await reconcileAcademicChargesWithAsaas({
          contaId,
          cobrancaIds: academicResultRaw.map((c) => c.id),
          limit: academicResultRaw.length,
        })
      : null;

  const academicResult = academicResultRaw.map((c) => {
    const reconciled = academicReconciliation?.items.get(c.id);
    return reconciled
      ? {
          ...c,
          status: reconciled.status,
          asaasPaymentId: reconciled.asaasPaymentId,
          asaasStatus: reconciled.asaasStatus,
          vencimento: reconciled.vencimento,
          dataPagamento: reconciled.dataPagamento,
          pagoEm: reconciled.pagoEm,
          liquidacaoStatus: reconciled.liquidacaoStatus,
          liquidadoEm: reconciled.liquidadoEm,
        }
      : c;
  });

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

  const reconciledStandaloneResult = isAsaasEnabled()
    ? await Promise.all(
        standaloneResult.map(async (charge) => {
          if (!shouldReconcileStandaloneCharge({ ...charge, now })) return charge;
          if (!charge.asaasPaymentId) return charge;

          try {
            recordAsaasReadIntent('RECONCILIATION');
            const payment = await getPayment(charge.asaasPaymentId, { contaId });
            const nextStatus = mapAsaasPaymentStatusToCharge(payment.status);
            const nextDueDate = parseAsaasDueDate(payment.dueDate) ?? charge.dueDate;
            const dueDateChanged =
              (charge.dueDate?.getTime() ?? null) !== (nextDueDate?.getTime() ?? null);

            if (charge.status !== nextStatus || dueDateChanged) {
              await _db.charge.updateMany({
                where: { id: charge.id },
                data: {
                  status: nextStatus,
                  dueDate: nextDueDate,
                  ...(charge.status !== nextStatus ? { statusUpdatedAt: new Date() } : {}),
                },
              });
            }

            return {
              ...charge,
              status: nextStatus,
              dueDate: nextDueDate,
            };
          } catch (error) {
            if (getAsaasErrorStatus(error) === 404) {
              await _db.charge.updateMany({
                where: { id: charge.id },
                data: {
                  asaasPaymentId: null,
                },
              });

              return {
                ...charge,
                asaasPaymentId: null,
              };
            }

            if (process.env.NODE_ENV !== 'test') {
              console.warn('[finance][listOperationalCharges] Falha ao reconciliar standalone com Asaas', {
                chargeId: charge.id,
                asaasPaymentId: charge.asaasPaymentId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return charge;
          }
        }),
      )
    : standaloneResult;

  const effectiveStandaloneResult = reconciledStandaloneResult.filter((charge) => {
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
      effectiveStandaloneResult
        .filter(
          (charge) =>
            isGenericPayerName(charge.payerName) &&
            charge.customer?.payerType === 'ALUNO' &&
            typeof charge.customer.payerId === 'string',
        )
        .map((charge) => charge.customer!.payerId),
    ),
  );

  const standaloneResponsavelIds = Array.from(
    new Set(
      effectiveStandaloneResult
        .filter(
          (charge) =>
            isGenericPayerName(charge.payerName) &&
            charge.customer?.payerType === 'RESPONSAVEL' &&
            typeof charge.customer.payerId === 'string',
        )
        .map((charge) => charge.customer!.payerId),
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

  // =================================================================
  // 5. Expor apenas itens operacionais relevantes
  // =================================================================
  const remoteItems = await listRemoteOperationalPaymentItems({
    contaId,
    endOfMonth,
    tipoFilter,
    search,
  });

  const allItemsWithMeta = [...academicItems, ...standaloneItems];
  const localAsaasPaymentIds = new Set(
    allItemsWithMeta
      .map((item) => item.asaasPaymentId)
      .filter((id): id is string => Boolean(id)),
  );
  const remoteItemsWithoutLocalDuplicate = remoteItems.filter(
    (item) => !item.asaasPaymentId || !localAsaasPaymentIds.has(item.asaasPaymentId),
  );
  const selectedIds = new Set<string>();

  const allOverdue = allItemsWithMeta.filter((item) => item.status === 'OVERDUE');
  for (const item of allOverdue) selectedIds.add(item.id);

  const subscriptionGroups = new Map<string, (UnifiedChargeItem & { _planId: string | null; _subscriptionKey: string | null })[]>();
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
    if (nextOpen) selectedIds.add(nextOpen.id);
  }

  for (const item of allItemsWithMeta) {
    if (selectedIds.has(item.id)) continue;

    const itemDueDate = item.dueDate ? new Date(item.dueDate) : null;

    if (item._planId) {
      if (['PENDING', 'PROCESSING'].includes(item.status) && (!itemDueDate || itemDueDate <= endOfMonth)) {
        selectedIds.add(item.id);
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
      selectedIds.add(item.id);
    }
  }

  const allItems: UnifiedChargeItem[] = allItemsWithMeta
    .filter((item) => selectedIds.has(item.id))
    .map((item) => {
      const { _planId, _subscriptionKey, ...clean } = item;
      return clean;
    })
    .concat(remoteItemsWithoutLocalDuplicate);

  // Ordenar: overdue primeiro (urgência), depois por vencimento ASC
  allItems.sort(compareOperationalItems);

  return allItems;
}

export async function getOperationalChargesSummary(
  input: ListOperationalChargesInput,
  db?: typeof prisma,
): Promise<OperationalChargesSummaryOutput> {
  const items = await buildOperationalChargesCollection(input, db);

  return {
    total: items.length,
    valorBruto: roundCurrency(items.reduce((sum, item) => sum + Number(item.value ?? 0), 0)),
  };
}

export async function listOperationalCharges(
  input: ListOperationalChargesInput,
  db?: typeof prisma,
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
