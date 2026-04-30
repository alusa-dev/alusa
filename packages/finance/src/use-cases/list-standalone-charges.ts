import { prisma } from '@alusa/database';
import type { UnifiedChargeStatus } from '../dtos/charge-list-item.dto';
import { normalizeChargeStatus } from '../dtos/unified-billing';
import { chargeReadModelService } from '../read-model/charge-read-model.service';

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export type ListStandaloneChargesInput = {
  contaId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  /** Filtro de status unificado. */
  statusView?: 'open' | 'paid' | 'all';
};

export type StandaloneChargeItem = {
  id: string;
  origin: 'STANDALONE';
  description: string | null;
  payerName: string;
  value: number;
  dueDate: string | null;
  billingType: string | null;
  status: UnifiedChargeStatus;
  chargeType: 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';
  linkStatus: 'LINKED' | 'UNLINKED' | 'NEEDS_REVIEW';
  groupId: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
  invoiceUrl: string | null;
  /** true se faz parte de um StandaloneInstallmentPlan (para mostrar badge). */
  isInstallment: boolean;
};

export type ListStandaloneChargesOutput = {
  items: StandaloneChargeItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ---------------------------------------------------------------------------
// Use-case
// ---------------------------------------------------------------------------

/**
 * Lista apenas cobranças standalone (avulsas) — sem vínculo acadêmico.
 *
 * Inclui apenas ONE_TIME (à vista).
 * Exclui:
 * - parcelas de StandaloneInstallmentPlan
 * - cobranças de assinatura standalone (prefixo dedicado)
 * Para a página "/cobrancas/avulsas".
 */
export async function listStandaloneCharges(
  input: ListStandaloneChargesInput,
  db?: typeof prisma,
): Promise<ListStandaloneChargesOutput> {
  const readModelEnabled = process.env.FIN_READMODEL_ENABLED === 'true';
  if (readModelEnabled) {
    return chargeReadModelService.listStandaloneChargesFromReadModel(input);
  }

  const _db = db ?? prisma;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const { contaId, search, statusView = 'open' } = input;

  // Apenas charges sem vínculo acadêmico
  const where: Record<string, unknown> = {
    contaId,
    cobrancaId: null,
    standaloneInstallmentPlanId: null,
    NOT: [
      { externalReference: { startsWith: 'alusa:standalone-subscription:' } },
      { externalReference: { startsWith: 'alusa:installment:' } },
      { externalReference: { startsWith: 'installmentPlan:' } },
    ],
  };

  // Filtro de status
  if (statusView === 'open') {
    where.status = { in: ['CREATED', 'OPEN', 'OVERDUE'] };
  } else if (statusView === 'paid') {
    where.status = 'PAID';
  }
  // 'all' = sem filtro de status

  // Busca textual
  if (search) {
    where.OR = [
      { payerName: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [charges, total] = await Promise.all([
    _db.charge.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        asaasPaymentId: true,
        payerName: true,
        description: true,
        value: true,
        dueDate: true,
        billingType: true,
        invoiceUrl: true,
        standaloneInstallmentPlanId: true,
        createdAt: true,
      },
    }),
    _db.charge.count({ where }),
  ]);

  const items: StandaloneChargeItem[] = charges.map((c) => ({
    id: c.id,
    origin: 'STANDALONE',
    description: c.description ?? 'Cobrança Avulsa',
    payerName: c.payerName ?? 'Cliente',
    value: c.value != null ? Number(c.value) : 0,
    dueDate: c.dueDate?.toISOString() ?? null,
    billingType: c.billingType,
    status: normalizeChargeStatus(c.status),
    chargeType: 'ONE_TIME',
    linkStatus: c.asaasPaymentId ? 'LINKED' : 'NEEDS_REVIEW',
    groupId: null,
    asaasPaymentId: c.asaasPaymentId,
    createdAt: c.createdAt.toISOString(),
    invoiceUrl: c.invoiceUrl,
    isInstallment: c.standaloneInstallmentPlanId != null,
  }));

  if (process.env.FIN_READMODEL_SHADOW_COMPARE === 'true') {
    try {
      const readModelResult = await chargeReadModelService.listStandaloneChargesFromReadModel(input);
      const legacyIds = new Set(items.map((item) => item.id));
      const readModelIds = new Set(readModelResult.items.map((item) => item.id));
      const onlyLegacy = items.filter((item) => !readModelIds.has(item.id)).slice(0, 10).map((item) => item.id);
      const onlyReadModel = readModelResult.items
        .filter((item) => !legacyIds.has(item.id))
        .slice(0, 10)
        .map((item) => item.id);

      if (items.length !== readModelResult.items.length || onlyLegacy.length || onlyReadModel.length) {
        console.warn('[finance][read-model][shadow][standalone]', {
          contaId,
          legacyTotal: items.length,
          readModelTotal: readModelResult.items.length,
          onlyLegacy,
          onlyReadModel,
        });
      }
    } catch (shadowError) {
      console.warn('[finance][read-model][shadow][standalone] compare failed', {
        contaId,
        error: shadowError instanceof Error ? shadowError.message : String(shadowError),
      });
    }
  }

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
