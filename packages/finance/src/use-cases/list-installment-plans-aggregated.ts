import { prisma } from '@alusa/database';
import type { InstallmentStatus } from '@prisma/client';
import type { UnifiedInstallmentGroupItem } from '../dtos/unified-billing';
import { resolveUnifiedChargeStatus } from '../dtos/unified-billing';
import { buildPaymentReferencePrefix, isPaymentReferenceForParent, parseInstallmentDescriptionIndex } from '../core';
import { resolveUnambiguousCustomerPayer } from '../customer/customer-identity';
import { getAcademicDateKey, getCurrentAcademicDateKey } from '@alusa/shared/date-only';

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export type ListInstallmentPlansAggregatedInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  /** Filtro consolidado exibido na lista; os valores legados seguem aceitos. */
  statusFilter?: InstallmentStatus | InstallmentStatus[] | StatusParcelamento | StatusParcelamento[];
  sortOrder?: 'ASC' | 'DESC';
};

export type InstallmentGroupItemDTO = UnifiedInstallmentGroupItem & {
  /** Status derivado das parcelas (EM_DIA, ATRASADO, QUITADO, CANCELADO). */
  statusConsolidado: StatusParcelamento;
  /** Próximo vencimento da parcela não-paga/não-cancelada. */
  proximoVencimento: string | null;
};

export type ListInstallmentPlansAggregatedOutput = {
  items: InstallmentGroupItemDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function matchesInstallmentSearch(params: {
  search?: string;
  studentName: string;
  payerName: string;
}) {
  const { search, studentName, payerName } = params;
  if (!search) return true;

  const normalized = search.toLowerCase();
  return (
    studentName.toLowerCase().includes(normalized) ||
    payerName.toLowerCase().includes(normalized)
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusParcelamento = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

const PAID_STATUSES = new Set(['PAGO', 'PAID']);

function mapUnifiedStatusToCobranca(status: string): string {
  switch (status) {
    case 'PROCESSING':
      return 'PROCESSANDO';
    case 'PAID':
      return 'PAGO';
    case 'OVERDUE':
      return 'ATRASADO';
    case 'CANCELED':
      return 'CANCELADO';
    case 'REFUNDED':
      return 'ESTORNADO';
    case 'PENDING':
    default:
      return 'PENDENTE';
  }
}

function resolveParcelaStatus(input: {
  localStatus: string;
  asaasStatus?: string | null;
  liquidacaoStatus?: string | null;
  hasAsaasLink?: boolean;
}): string {
  return mapUnifiedStatusToCobranca(resolveUnifiedChargeStatus(input));
}

function deriveStatus(
  planStatus: string,
  installmentCount: number,
  parcelas: Array<{ status: string; vencimento: Date | null; installmentIndex?: number | null }>,
  todayKey: string,
): StatusParcelamento {
  if (planStatus === 'CANCELED') return 'CANCELADO';

  if (parcelas.length === 0) return 'EM_DIA';

  const allCanceled = parcelas.every((p) => p.status === 'CANCELADO');
  if (allCanceled) return 'CANCELADO';

  const allPaid = parcelas.every((p) => PAID_STATUSES.has(p.status));
  // A conclusão do plano e as parcelas já materializadas podem chegar em
  // momentos diferentes. Só exibir quitado quando o conjunto local cobre
  // todas as parcelas esperadas, para não esconder faturas ausentes.
  const materializedIndices = new Set(parcelas.map((p) => p.installmentIndex).filter((index): index is number => index != null));
  const planIsFullyMaterialized =
    installmentCount > 0 &&
    materializedIndices.size === installmentCount &&
    Array.from({ length: installmentCount }, (_, index) => index + 1)
      .every((index) => materializedIndices.has(index));
  if (planIsFullyMaterialized && allPaid && parcelas.length > 0) return 'QUITADO';

  const allSettled = parcelas.every(
    (p) => PAID_STATUSES.has(p.status) || p.status === 'CANCELADO',
  );
  const hasPaid = parcelas.some((p) => PAID_STATUSES.has(p.status));
  if (planIsFullyMaterialized && allSettled && hasPaid) return 'QUITADO';

  const hasOverdue = parcelas.some(
    (p) =>
      !PAID_STATUSES.has(p.status) &&
      p.status !== 'CANCELADO' &&
      p.vencimento !== null &&
      (getAcademicDateKey(p.vencimento) ?? '') < todayKey,
  );

  return hasOverdue ? 'ATRASADO' : 'EM_DIA';
}

function mapPlanStatusToDTO(status: InstallmentStatus): 'ACTIVE' | 'COMPLETED' | 'CANCELED' {
  switch (status) {
    case 'ACTIVE': return 'ACTIVE';
    case 'COMPLETED': return 'COMPLETED';
    case 'CANCELED': return 'CANCELED';
    default: return 'ACTIVE';
  }
}

// ---------------------------------------------------------------------------
// Use-case
// ---------------------------------------------------------------------------

/**
 * Lista parcelamentos agrupados (Academic InstallmentPlan + StandaloneInstallmentPlan).
 *
 * Enriquece com: status derivado das parcelas, parcelas pagas, próximo vencimento.
 * Para a página "/cobrancas/parcelamentos".
 */
export async function listInstallmentPlansAggregated(
  input: ListInstallmentPlansAggregatedInput,
  db?: typeof prisma,
): Promise<ListInstallmentPlansAggregatedOutput> {
  const _db = db ?? prisma;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const { contaId, search, statusFilter } = input;
  const account = typeof (_db as { conta?: { findUnique?: unknown } }).conta?.findUnique === 'function'
    ? await (_db as typeof prisma).conta.findUnique({ where: { id: contaId }, select: { timezone: true } })
    : null;
  const todayKey = getCurrentAcademicDateKey(new Date(), account?.timezone ?? undefined);

  // =================================================================
  // 1. Buscar Academic InstallmentPlans
  // =================================================================
  const academicWhere: Record<string, unknown> = { contaId };
  // O filtro de status é aplicado depois de derivar statusConsolidado das
  // parcelas; filtrar pelo status bruto do plano diverge do que a tela exibe.

  const [installmentPlans, standalonePlans] = await Promise.all([
    _db.installmentPlan.findMany({
      where: academicWhere,
      orderBy: { createdAt: 'desc' },
      include: {
        matricula: {
          select: {
            id: true,
            aluno: { select: { nome: true } },
            responsavelFinanceiro: { select: { nome: true } },
          },
        },
      },
    }),
    _db.standaloneInstallmentPlan.findMany({
      where: academicWhere, // contaId + statusFilter (mesmos campos)
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        externalReference: true,
        status: true,
        installmentCount: true,
        billingType: true,
        value: true,
        firstDueDate: true,
        asaasInstallmentId: true,
        createdAt: true,
        payerType: true,
        payerId: true,
        customer: {
          select: {
            payerType: true,
            payerId: true,
            payerLinks: { select: { payerType: true, payerId: true } },
          },
        },
      },
    }),
  ]);

  // =================================================================
  // 2. Buscar parcelas vinculadas via externalReference (academic)
  // =================================================================
  const planExternalRefs = installmentPlans
    .filter((p) => p.externalReference)
    .map((p) => p.externalReference!);

  const [academicCharges, standaloneCharges] = await Promise.all([
    planExternalRefs.length
      ? _db.charge.findMany({
          where: {
            contaId,
            OR: planExternalRefs.flatMap((ref) => [
              { externalReference: ref },
              { externalReference: { startsWith: buildPaymentReferencePrefix(ref) } },
            ]),
          },
          select: {
            asaasPaymentId: true,
            asaasStatus: true,
            liquidacaoStatus: true,
            externalReference: true,
            cobranca: {
              select: {
                id: true,
                status: true,
                descricao: true,
                asaasPaymentId: true,
                asaasStatus: true,
                liquidacaoStatus: true,
                vencimento: true,
              },
            },
          },
        })
      : Promise.resolve([]),

    // Buscar parcelas vinculadas via FK (standalone)
    standalonePlans.length
      ? _db.charge.findMany({
          where: {
            contaId,
            standaloneInstallmentPlanId: { in: standalonePlans.map((p) => p.id) },
          },
          select: {
            standaloneInstallmentPlanId: true,
            externalReference: true,
            asaasPaymentId: true,
            asaasStatus: true,
            liquidacaoStatus: true,
            payerName: true,
            status: true,
            dueDate: true,
            description: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // =================================================================
  // 3. Resolver nomes dos pagadores standalone
  // =================================================================
  const payerByStandalonePlanId = new Map(
    standalonePlans.flatMap((plan) => {
      const payer = plan.payerType && plan.payerId
        ? { payerType: plan.payerType, payerId: plan.payerId }
        : resolveUnambiguousCustomerPayer(plan.customer);
      return payer ? [[plan.id, payer] as const] : [];
    }),
  );
  const respIds = standalonePlans
    .map((p) => payerByStandalonePlanId.get(p.id))
    .filter((payer) => payer?.payerType === 'RESPONSAVEL')
    .map((payer) => payer!.payerId);
  const aluIds = standalonePlans
    .map((p) => payerByStandalonePlanId.get(p.id))
    .filter((payer) => payer?.payerType === 'ALUNO')
    .map((payer) => payer!.payerId);
  const [responsaveis, alunos] = await Promise.all([
    respIds.length ? _db.responsavel.findMany({ where: { contaId, id: { in: respIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
    aluIds.length ? _db.aluno.findMany({ where: { contaId, id: { in: aluIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
  ]);
  const respMap = new Map(responsaveis.map((r) => [r.id, r.nome]));
  const aluMap = new Map(alunos.map((a) => [a.id, a.nome]));

  // =================================================================
  // 4. Agrupar cobranças acadêmicas por planId (via externalReference prefix)
  // =================================================================
  const cobrancasByPlanId = new Map<string, Array<{ status: string; vencimento: Date; installmentIndex: number | null }>>();
  for (const charge of academicCharges) {
    if (!charge.cobranca || !charge.externalReference) continue;
    const ownerPlan = installmentPlans.find(
      (p) => isPaymentReferenceForParent(charge.externalReference, p.externalReference),
    );
    if (!ownerPlan) continue;
    const arr = cobrancasByPlanId.get(ownerPlan.id) ?? [];
    arr.push({
      status: resolveParcelaStatus({
        localStatus: charge.cobranca.status,
        asaasStatus: charge.cobranca.asaasStatus ?? charge.asaasStatus ?? null,
        liquidacaoStatus: charge.cobranca.liquidacaoStatus ?? charge.liquidacaoStatus ?? null,
        hasAsaasLink: Boolean(charge.cobranca.asaasPaymentId ?? charge.asaasPaymentId),
      }),
      vencimento: charge.cobranca.vencimento,
      installmentIndex: parseInstallmentDescriptionIndex(charge.cobranca.descricao, ownerPlan.installmentCount),
    });
    cobrancasByPlanId.set(ownerPlan.id, arr);
  }

  // =================================================================
  // 5. Montar items
  // =================================================================
  const allItems: InstallmentGroupItemDTO[] = [];

  // Academic plans
  for (const plan of installmentPlans) {
    const studentName =
      plan.matricula.aluno?.nome ??
      plan.matricula.responsavelFinanceiro?.nome ??
      'Cliente';
    const payerName =
      plan.matricula.responsavelFinanceiro?.nome ??
      plan.matricula.aluno?.nome ??
      'Cliente';

    // Filtro de busca
    if (!matchesInstallmentSearch({ search, studentName, payerName })) {
      continue;
    }

    const parcelas = cobrancasByPlanId.get(plan.id) ?? [];
    const totalParcelas = plan.installmentCount;
    const parcelasPagas = Math.min(
      parcelas.filter((p) => PAID_STATUSES.has(p.status)).length,
      totalParcelas,
    );

    const sortedParcelas = [...parcelas].sort(
      (a, b) => a.vencimento.getTime() - b.vencimento.getTime(),
    );
    const proxima = sortedParcelas.find(
      (p) => p.vencimento !== null && !PAID_STATUSES.has(p.status) && p.status !== 'CANCELADO' && p.status !== 'ESTORNADO',
    );

    const statusConsolidado = deriveStatus(plan.status, totalParcelas, parcelas, todayKey);

    // InstallmentPlan.value = per-installment
    const installmentValue = Number(plan.value);
    const totalValue = installmentValue * totalParcelas;

    allItems.push({
      id: plan.id,
      origin: 'ACADEMIC',
      studentName,
      payerName,
      totalValue,
      installmentValue,
      installmentCount: totalParcelas,
      installmentsPaid: parcelasPagas,
      billingType: plan.billingType,
      firstDueDate: plan.firstDueDate.toISOString(),
      status: mapPlanStatusToDTO(plan.status),
      createdAt: plan.createdAt.toISOString(),
      matriculaId: plan.matricula.id,
      contratoId: plan.contratoId,
      asaasInstallmentId: plan.asaasInstallmentId,
      statusConsolidado,
      proximoVencimento: proxima?.vencimento?.toISOString() ?? null,
    });
  }

  // Standalone plans
  const standalonePlanById = new Map(standalonePlans.map((plan) => [plan.id, plan]));
  const standaloneChargesByPlan = new Map<string, Array<{ status: string; vencimento: Date | null; payerName: string | null; installmentIndex: number | null }>>();
  for (const charge of standaloneCharges) {
    if (!charge.standaloneInstallmentPlanId) continue;
    const arr = standaloneChargesByPlan.get(charge.standaloneInstallmentPlanId) ?? [];
    arr.push({
      payerName: charge.payerName,
      installmentIndex: parseInstallmentDescriptionIndex(
        charge.description,
        standalonePlanById.get(charge.standaloneInstallmentPlanId)?.installmentCount ?? 0,
      ),
      status: resolveParcelaStatus({
        localStatus: charge.status,
        asaasStatus: charge.asaasStatus,
        liquidacaoStatus: charge.liquidacaoStatus,
        hasAsaasLink: Boolean(charge.asaasPaymentId),
      }),
      vencimento: charge.dueDate,
    });
    standaloneChargesByPlan.set(charge.standaloneInstallmentPlanId, arr);
  }

  for (const plan of standalonePlans) {
    const parcelas = standaloneChargesByPlan.get(plan.id) ?? [];
    const payer = payerByStandalonePlanId.get(plan.id) ?? null;
    const payerName = payer
      ? payer.payerType === 'RESPONSAVEL'
        ? respMap.get(payer.payerId) ?? 'Cliente'
        : aluMap.get(payer.payerId) ?? 'Cliente'
      : parcelas.find((parcela) => parcela.payerName)?.payerName ?? 'Cliente';
    const studentName = parcelas.find((parcela) => parcela.payerName && parcela.payerName.trim().length > 0)?.payerName ?? payerName;

    if (!matchesInstallmentSearch({ search, studentName, payerName })) {
      continue;
    }
    const parcelasPagas = Math.min(
      parcelas.filter((p) => PAID_STATUSES.has(p.status)).length,
      plan.installmentCount,
    );

    const sortedParcelas = [...parcelas].sort(
      (a, b) => (a.vencimento?.getTime() ?? Number.POSITIVE_INFINITY) - (b.vencimento?.getTime() ?? Number.POSITIVE_INFINITY),
    );
    const proxima = sortedParcelas.find(
      (p) => p.vencimento !== null && !PAID_STATUSES.has(p.status) && p.status !== 'CANCELADO' && p.status !== 'ESTORNADO',
    );

    const statusConsolidado = deriveStatus(plan.status, plan.installmentCount, parcelas, todayKey);

    // StandaloneInstallmentPlan.value = total amount
    const totalValue = Number(plan.value);
    const installmentValue = totalValue / plan.installmentCount;

    allItems.push({
      id: plan.id,
      origin: 'STANDALONE',
      studentName,
      payerName,
      totalValue,
      installmentValue,
      installmentCount: plan.installmentCount,
      installmentsPaid: parcelasPagas,
      billingType: plan.billingType,
      firstDueDate: plan.firstDueDate.toISOString(),
      status: mapPlanStatusToDTO(plan.status),
      createdAt: plan.createdAt.toISOString(),
      matriculaId: null,
      contratoId: null,
      asaasInstallmentId: plan.asaasInstallmentId,
      statusConsolidado,
      proximoVencimento: proxima?.vencimento?.toISOString() ?? null,
    });
  }

  // =================================================================
  // 6. Paginação (in-memory, pois search/status-consolidado são pós-query)
  // =================================================================
  const filteredItems = statusFilter
    ? allItems.filter((item) => {
        const statuses = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
        const acceptedStatuses = new Set<StatusParcelamento>();
        for (const status of statuses) {
          if (status === 'CANCELED' || status === 'CANCELADO') acceptedStatuses.add('CANCELADO');
          else if (status === 'COMPLETED' || status === 'QUITADO') acceptedStatuses.add('QUITADO');
          else if (status === 'ACTIVE') {
            acceptedStatuses.add('EM_DIA');
            acceptedStatuses.add('ATRASADO');
          } else if (status === 'EM_DIA' || status === 'ATRASADO') acceptedStatuses.add(status);
        }
        return acceptedStatuses.size === 0 || acceptedStatuses.has(item.statusConsolidado);
      })
    : allItems;
  const total = filteredItems.length;
  const orderedItems = [...filteredItems].sort((a, b) => {
    const cmp = a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    return input.sortOrder === 'ASC' ? cmp : -cmp;
  });
  const paginatedItems = orderedItems.slice((page - 1) * pageSize, page * pageSize);

  return {
    items: paginatedItems,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
