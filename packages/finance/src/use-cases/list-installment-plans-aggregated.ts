import { prisma } from '@alusa/database';
import type { InstallmentStatus } from '@prisma/client';
import type { UnifiedInstallmentGroupItem } from '../dtos/unified-billing';
import { buildPaymentReferencePrefix, isPaymentReferenceForParent } from '../core';

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export type ListInstallmentPlansAggregatedInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  /** Filtro de status do plano (Prisma InstallmentStatus). */
  statusFilter?: InstallmentStatus | InstallmentStatus[];
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

function mapChargeStatusToCobranca(status: string): string {
  switch (status) {
    case 'CREATED':
    case 'OPEN':
      return 'PENDENTE';
    case 'PAID':
      return 'PAGO';
    case 'OVERDUE':
      return 'ATRASADO';
    case 'CANCELED':
      return 'CANCELADO';
    case 'REFUNDED':
      return 'ESTORNADO';
    default:
      return status;
  }
}

function deriveStatus(
  planStatus: string,
  parcelas: Array<{ status: string; vencimento: Date }>,
): StatusParcelamento {
  if (planStatus === 'CANCELED') return 'CANCELADO';
  if (planStatus === 'COMPLETED') return 'QUITADO';

  if (parcelas.length === 0) return 'EM_DIA';

  const allCanceled = parcelas.every((p) => p.status === 'CANCELADO');
  if (allCanceled) return 'CANCELADO';

  const allPaid = parcelas.every((p) => PAID_STATUSES.has(p.status));
  if (allPaid && parcelas.length > 0) return 'QUITADO';

  const allSettled = parcelas.every(
    (p) => PAID_STATUSES.has(p.status) || p.status === 'CANCELADO',
  );
  const hasPaid = parcelas.some((p) => PAID_STATUSES.has(p.status));
  if (allSettled && hasPaid) return 'QUITADO';

  const now = new Date();
  const hasOverdue = parcelas.some(
    (p) =>
      !PAID_STATUSES.has(p.status) &&
      p.status !== 'CANCELADO' &&
      new Date(p.vencimento) < now,
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

  // =================================================================
  // 1. Buscar Academic InstallmentPlans
  // =================================================================
  const academicWhere: Record<string, unknown> = { contaId };
  if (statusFilter) {
    academicWhere.status = Array.isArray(statusFilter) ? { in: statusFilter } : statusFilter;
  }

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
      include: {
        customer: { select: { payerType: true, payerId: true } },
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
            externalReference: true,
            cobranca: {
              select: { id: true, status: true, vencimento: true },
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
            payerName: true,
            status: true,
            dueDate: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // =================================================================
  // 3. Resolver nomes dos pagadores standalone
  // =================================================================
  const respIds = standalonePlans.filter((p) => p.customer.payerType === 'RESPONSAVEL').map((p) => p.customer.payerId);
  const aluIds = standalonePlans.filter((p) => p.customer.payerType === 'ALUNO').map((p) => p.customer.payerId);
  const [responsaveis, alunos] = await Promise.all([
    respIds.length ? _db.responsavel.findMany({ where: { id: { in: respIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
    aluIds.length ? _db.aluno.findMany({ where: { id: { in: aluIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
  ]);
  const respMap = new Map(responsaveis.map((r) => [r.id, r.nome]));
  const aluMap = new Map(alunos.map((a) => [a.id, a.nome]));

  // =================================================================
  // 4. Agrupar cobranças acadêmicas por planId (via externalReference prefix)
  // =================================================================
  const cobrancasByPlanId = new Map<string, Array<{ status: string; vencimento: Date }>>();
  for (const charge of academicCharges) {
    if (!charge.cobranca || !charge.externalReference) continue;
    const ownerPlan = installmentPlans.find(
      (p) => isPaymentReferenceForParent(charge.externalReference, p.externalReference),
    );
    if (!ownerPlan) continue;
    const arr = cobrancasByPlanId.get(ownerPlan.id) ?? [];
    arr.push({ status: charge.cobranca.status, vencimento: charge.cobranca.vencimento });
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
      (p) => !PAID_STATUSES.has(p.status) && p.status !== 'CANCELADO',
    );

    const statusConsolidado = deriveStatus(plan.status, parcelas);

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
  const standaloneChargesByPlan = new Map<string, Array<{ status: string; vencimento: Date; payerName: string | null }>>();
  for (const charge of standaloneCharges) {
    if (!charge.standaloneInstallmentPlanId) continue;
    const arr = standaloneChargesByPlan.get(charge.standaloneInstallmentPlanId) ?? [];
    arr.push({
      payerName: charge.payerName,
      status: mapChargeStatusToCobranca(charge.status),
      vencimento: charge.dueDate ?? new Date(),
    });
    standaloneChargesByPlan.set(charge.standaloneInstallmentPlanId, arr);
  }

  for (const plan of standalonePlans) {
    const parcelas = standaloneChargesByPlan.get(plan.id) ?? [];
    const payerName =
      plan.customer.payerType === 'RESPONSAVEL'
        ? respMap.get(plan.customer.payerId) ?? 'Cliente'
        : aluMap.get(plan.customer.payerId) ?? 'Cliente';
    const studentName = parcelas.find((parcela) => parcela.payerName && parcela.payerName.trim().length > 0)?.payerName ?? payerName;

    if (!matchesInstallmentSearch({ search, studentName, payerName })) {
      continue;
    }
    const parcelasPagas = Math.min(
      parcelas.filter((p) => PAID_STATUSES.has(p.status)).length,
      plan.installmentCount,
    );

    const sortedParcelas = [...parcelas].sort(
      (a, b) => a.vencimento.getTime() - b.vencimento.getTime(),
    );
    const proxima = sortedParcelas.find(
      (p) => !PAID_STATUSES.has(p.status) && p.status !== 'CANCELADO',
    );

    const statusConsolidado = deriveStatus(plan.status, parcelas);

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
  const total = allItems.length;
  const paginatedItems = allItems.slice((page - 1) * pageSize, page * pageSize);

  return {
    items: paginatedItems,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
