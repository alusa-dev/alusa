import { prisma } from '@alusa/database';
import type { InstallmentStatus, ChargeStatus, Prisma } from '@prisma/client';
import { buildPaymentReferencePrefix } from '../core';

// ═══════════════════════════════════════════════════════════════════════════
// BASIC LIST (existing)
// ═══════════════════════════════════════════════════════════════════════════

export type ListInstallmentPlansInput = {
  contaId: string;
  limit: number;
  offset: number;
  status?: InstallmentStatus;
};

export type InstallmentPlanListItem = {
  id: string;
  contratoId: string;
  matriculaId: string;
  externalReference: string;
  asaasInstallmentId: string | null;
  status: InstallmentStatus;
  installmentCount: number;
  billingType: string;
  amount: string;
  firstDueDate: string;
  statusUpdatedAt: string;
  createdAt: string;
};

export type ListInstallmentPlansOutput = { items: InstallmentPlanListItem[]; total: number };

function toDateISO(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function listInstallmentPlans(input: ListInstallmentPlansInput): Promise<ListInstallmentPlansOutput> {
  const where: { contaId: string; status?: InstallmentStatus } = { contaId: input.contaId };
  if (input.status) where.status = input.status;

  const [total, items] = await Promise.all([
    prisma.installmentPlan.count({ where }),
    prisma.installmentPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      skip: input.offset,
      select: {
        id: true,
        contratoId: true,
        matriculaId: true,
        externalReference: true,
        asaasInstallmentId: true,
        status: true,
        installmentCount: true,
        billingType: true,
        value: true,
        firstDueDate: true,
        statusUpdatedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    total,
    items: items.map((item) => ({
      id: item.id,
      contratoId: item.contratoId,
      matriculaId: item.matriculaId,
      externalReference: item.externalReference,
      asaasInstallmentId: item.asaasInstallmentId ?? null,
      status: item.status,
      installmentCount: item.installmentCount,
      billingType: item.billingType,
      amount: String(item.value),
      firstDueDate: toDateISO(item.firstDueDate),
      statusUpdatedAt: item.statusUpdatedAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENRICHED LIST FOR FINANCE PANEL
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_LABELS: Record<InstallmentStatus, string> = {
  ACTIVE: 'Ativo',
  COMPLETED: 'Quitado',
  CANCELED: 'Cancelado',
};

type StatusParcelamento = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

const PAID_STATUSES = new Set(['PAGO', 'PAID']);

function deriveInstallmentPlanStatusFromCharges(
  planStatus: InstallmentStatus,
  charges: Array<{ status: string; dueDate: Date | null }>
): StatusParcelamento {
  if (planStatus === 'CANCELED') return 'CANCELADO';
  if (planStatus === 'COMPLETED') return 'QUITADO';

  const now = new Date();
  const hasOverdue = charges.some(
    (c) =>
      !PAID_STATUSES.has(c.status) &&
      c.status !== 'CANCELED' &&
      c.dueDate &&
      new Date(c.dueDate) < now
  );

  if (hasOverdue) return 'ATRASADO';

  const allPaid = charges.every((c) => PAID_STATUSES.has(c.status));
  if (allPaid && charges.length > 0) return 'QUITADO';

  return 'EM_DIA';
}

function normalizeChargeStatus(status: ChargeStatus | string): string {
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

export interface ListInstallmentPlansFinanceInput {
  contaId: string;
  page?: number;
  pageSize?: number;
  status?: InstallmentStatus | InstallmentStatus[];
  search?: string;
}

export interface InstallmentPlanFinanceDTO {
  id: string;
  asaasInstallmentId: string | null;
  externalReference: string;
  status: InstallmentStatus;
  statusLabel: string;
  statusConsolidado: StatusParcelamento;
  clienteNome: string;
  alunoNome: string;
  valorTotal: number;
  numeroParcelas: number;
  parcelasPagas: number;
  proximoVencimento: string | null;
  matriculaId: string;
  contratoId: string;
  createdAt: string;
}

export interface ListInstallmentPlansFinanceOutput {
  items: InstallmentPlanFinanceDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Lista parcelamentos com dados enriquecidos para painel financeiro.
 * Agrega por asaasInstallmentId (fonte determinística).
 */
export async function listInstallmentPlansForFinance(
  input: ListInstallmentPlansFinanceInput
): Promise<ListInstallmentPlansFinanceOutput> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const { contaId, status, search } = input;

  const where: Prisma.InstallmentPlanWhereInput = { contaId };

  if (status) {
    where.status = Array.isArray(status) ? { in: status } : status;
  }

  const [plans, total] = await Promise.all([
    prisma.installmentPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
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
    prisma.installmentPlan.count({ where }),
  ]);

  const itemsOrNull = await Promise.all(
    plans.map(async (plan) => {
      const matricula = plan.matricula;
      const clienteNome =
        matricula.responsavelFinanceiro?.nome ?? matricula.aluno?.nome ?? 'Cliente';
      const alunoNome = matricula.aluno?.nome ?? 'Aluno';

      // Buscar parcelas via externalReference (determinístico)
      const charges = await prisma.charge.findMany({
        where: {
          contaId,
          OR: [
            { externalReference: plan.externalReference },
            { externalReference: { startsWith: buildPaymentReferencePrefix(plan.externalReference) } },
          ],
        },
        orderBy: { dueDate: 'asc' },
        select: {
          status: true,
          dueDate: true,
          value: true,
          asaasPaymentId: true,
        },
      });

      const cobrancas = await prisma.cobranca.findMany({
        where: {
          matriculaId: plan.matriculaId,
          tipo: 'PARCELADA',
        },
        orderBy: { vencimento: 'asc' },
        select: {
          status: true,
          vencimento: true,
          valor: true,
          asaasPaymentId: true,
        },
      });

      const mergedByPayment = new Map<
        string,
        { status: string; dueDate: Date | null; value: number | null }
      >();

      for (const cobranca of cobrancas) {
        if (!cobranca.asaasPaymentId) continue;
        mergedByPayment.set(cobranca.asaasPaymentId, {
          status: cobranca.status,
          dueDate: cobranca.vencimento,
          value: cobranca.valor ? Number(cobranca.valor) : null,
        });
      }

      const chargesSemPagamento: Array<{ status: string; dueDate: Date | null; value: number | null }> = [];

      for (const charge of charges) {
        if (charge.asaasPaymentId) {
          const existing = mergedByPayment.get(charge.asaasPaymentId);
          if (existing) {
            mergedByPayment.set(charge.asaasPaymentId, {
              status: existing.status,
              dueDate: charge.dueDate ?? existing.dueDate,
              value: charge.value ? Number(charge.value) : existing.value,
            });
          } else {
            mergedByPayment.set(charge.asaasPaymentId, {
              status: normalizeChargeStatus(charge.status),
              dueDate: charge.dueDate,
              value: charge.value ? Number(charge.value) : null,
            });
          }
        } else {
          chargesSemPagamento.push({
            status: normalizeChargeStatus(charge.status),
            dueDate: charge.dueDate,
            value: charge.value ? Number(charge.value) : null,
          });
        }
      }

      const mergedCharges = [
        ...mergedByPayment.values(),
        ...chargesSemPagamento,
      ];

      const parcelasPagas = Math.min(
        mergedCharges.filter((c) => PAID_STATUSES.has(normalizeChargeStatus(c.status))).length,
        plan.installmentCount,
      );

      const statusConsolidado = deriveInstallmentPlanStatusFromCharges(
        plan.status,
        mergedCharges.map((c) => ({ status: normalizeChargeStatus(c.status), dueDate: c.dueDate }))
      );

      // Próximo vencimento
      const now = new Date();
      const proxima = mergedCharges.find(
        (c) =>
          !PAID_STATUSES.has(normalizeChargeStatus(c.status)) &&
          c.status !== 'CANCELED' &&
          c.dueDate &&
          new Date(c.dueDate) >= now
      );
      const proximoVencimento = proxima?.dueDate?.toISOString() ?? null;

      // Filtro de busca
      if (search) {
        const q = search.toLowerCase();
        const matchCliente = clienteNome.toLowerCase().includes(q);
        const matchAluno = alunoNome.toLowerCase().includes(q);
        if (!matchCliente && !matchAluno) return null;
      }

      return {
        id: plan.id,
        asaasInstallmentId: plan.asaasInstallmentId,
        externalReference: plan.externalReference,
        status: plan.status,
        statusLabel: STATUS_LABELS[plan.status] ?? plan.status,
        statusConsolidado,
        clienteNome,
        alunoNome,
        valorTotal: Number(plan.value) * plan.installmentCount,
        numeroParcelas: plan.installmentCount,
        parcelasPagas,
        proximoVencimento,
        matriculaId: plan.matriculaId,
        contratoId: plan.contratoId,
        createdAt: plan.createdAt.toISOString(),
      };
    })
  );

  const items = itemsOrNull.filter(
    (item): item is InstallmentPlanFinanceDTO => item !== null
  );
  const adjustedTotal = search ? items.length : total;

  return {
    items,
    total: adjustedTotal,
    page,
    pageSize,
    totalPages: Math.ceil(adjustedTotal / pageSize),
  };
}
