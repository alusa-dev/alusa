import { prisma } from '@alusa/database';
import type { SubscriptionStatus, Prisma } from '@prisma/client';
import { buildPaymentReferencePrefix, isPaymentReferenceForParent } from '../core';

type StandaloneSubscriptionFindManyArgs = {
  where: { contaId: string };
  orderBy: { createdAt: 'desc' };
  select: {
    id: true;
    asaasSubscriptionId: true;
    externalReference: true;
    status: true;
    cycle: true;
    billingType: true;
    value: true;
    nextDueDate: true;
    description: true;
    customerId: true;
    createdAt: true;
    customer: {
      select: {
        payerType: true;
        payerId: true;
      };
    };
  };
};

function getStandaloneSubscriptionDelegate() {
  return (prisma as unknown as {
    standaloneSubscription?: {
      findMany: (_args: StandaloneSubscriptionFindManyArgs) => Promise<Array<{
        id: string;
        asaasSubscriptionId: string | null;
        externalReference: string;
        status: SubscriptionStatus;
        cycle: string;
        billingType: string;
        value: Prisma.Decimal | number;
        nextDueDate: Date | null;
        description: string | null;
        customerId: string;
        createdAt: Date;
        customer: { payerType: string; payerId: string | null } | null;
      }>>;
    };
  }).standaloneSubscription;
}

// ═══════════════════════════════════════════════════════════════════════════
// BASIC LIST (existing)
// ═══════════════════════════════════════════════════════════════════════════

export type ListSubscriptionsInput = {
  contaId: string;
  limit: number;
  offset: number;
  status?: SubscriptionStatus;
};

export type SubscriptionListItem = {
  id: string;
  contratoId: string;
  matriculaId: string;
  externalReference: string;
  asaasSubscriptionId: string | null;
  status: SubscriptionStatus;
  statusUpdatedAt: string;
  createdAt: string;
};

export type ListSubscriptionsOutput = { items: SubscriptionListItem[]; total: number };

export async function listSubscriptions(input: ListSubscriptionsInput): Promise<ListSubscriptionsOutput> {
  const where: { contaId: string; status?: SubscriptionStatus } = { contaId: input.contaId };
  if (input.status) where.status = input.status;

  const [total, items] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      skip: input.offset,
      select: {
        id: true,
        contratoId: true,
        matriculaId: true,
        externalReference: true,
        asaasSubscriptionId: true,
        status: true,
        statusUpdatedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    total,
    items: items.map((item) => ({
      id: item.id,
      contratoId: item.contratoId ?? '',
      matriculaId: item.matriculaId,
      externalReference: item.externalReference,
      asaasSubscriptionId: item.asaasSubscriptionId ?? null,
      status: item.status,
      statusUpdatedAt: item.statusUpdatedAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

async function loadFinanceSubscriptionSources(params: {
  contaId: string;
  status?: SubscriptionStatus | SubscriptionStatus[];
  search?: string;
}) {
  const where: Prisma.SubscriptionWhereInput = { contaId: params.contaId };

  if (params.status) {
    where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
  }

  if (params.search) {
    where.matricula = {
      OR: [
        { aluno: { nome: { contains: params.search, mode: 'insensitive' } } },
        { responsavelFinanceiro: { nome: { contains: params.search, mode: 'insensitive' } } },
        { plano: { nome: { contains: params.search, mode: 'insensitive' } } },
        { plano: { descricao: { contains: params.search, mode: 'insensitive' } } },
        { combo: { nome: { contains: params.search, mode: 'insensitive' } } },
      ],
    };
  }

  const standaloneSubscriptionDelegate = getStandaloneSubscriptionDelegate();

  return Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        matricula: {
          select: {
            id: true,
            vencimentoDia: true,
            formaPagamento: true,
            formaPagamentoTaxa: true,
            aluno: { select: { id: true, nome: true, dataNasc: true } },
            responsavelFinanceiro: { select: { id: true, nome: true } },
            plano: { select: { nome: true, valor: true, periodicidade: true, descricao: true } },
            combo: { select: { nome: true, valor: true } },
          },
        },
      },
    }),
    standaloneSubscriptionDelegate
      ? standaloneSubscriptionDelegate.findMany({
          where: { contaId: params.contaId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            asaasSubscriptionId: true,
            externalReference: true,
            status: true,
            cycle: true,
            billingType: true,
            value: true,
            nextDueDate: true,
            description: true,
            customerId: true,
            createdAt: true,
            customer: {
              select: {
                payerType: true,
                payerId: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: {
        contaId: params.contaId,
        action: 'finance.standalone_subscription.created',
        entityType: 'StandaloneSubscription',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENRICHED LIST FOR FINANCE PANEL
// ═══════════════════════════════════════════════════════════════════════════

const CYCLE_LABELS: Record<string, string> = {
  MENSAL: 'Mensal',
  SEMANAL: 'Semanal',
  QUINZENAL: 'Quinzenal',
  BIMESTRAL: 'Bimestral',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUALLY: 'Semestral',
  YEARLY: 'Anual',
};

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  REQUESTED: 'Solicitada',
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
  EXPIRED: 'Expirada',
  DELETED: 'Excluída',
  FAILED: 'Falhou',
};

function calcularIdade(dataNasc: Date | null): number {
  if (!dataNasc) return 0;
  const hoje = new Date();
  let idade = hoje.getFullYear() - dataNasc.getFullYear();
  const m = hoje.getMonth() - dataNasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < dataNasc.getDate())) {
    idade--;
  }
  return idade;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toSubscriptionStatus(value: unknown): SubscriptionStatus {
  if (value === 'REQUESTED' || value === 'ACTIVE' || value === 'INACTIVE' || value === 'EXPIRED' || value === 'DELETED' || value === 'FAILED') {
    return value;
  }
  return 'REQUESTED';
}

export interface ListSubscriptionsFinanceInput {
  contaId: string;
  page?: number;
  pageSize?: number;
  status?: SubscriptionStatus | SubscriptionStatus[];
  search?: string;
}

export interface SubscriptionFinanceDTO {
  id: string;
  asaasSubscriptionId: string | null;
  externalReference: string;
  status: SubscriptionStatus;
  statusLabel: string;
  clienteNome: string;
  alunoNome: string;
  alunoId: string;
  valor: number;
  cycle: string;
  cycleLabel: string;
  billingType: string;
  description: string | null;
  nextDueDate: string | null;
  matriculaId: string;
  createdAt: string;
  /** Tipo/origem da assinatura: 'PLANO' | 'COMBO' | 'AVULSA' */
  tipo: 'PLANO' | 'COMBO' | 'AVULSA';
}

export interface ListSubscriptionsFinanceOutput {
  items: SubscriptionFinanceDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Lista assinaturas com dados enriquecidos para painel financeiro.
 * Usa Subscription local + busca próximo vencimento via Charge.
 */
export async function listSubscriptionsForFinance(
  input: ListSubscriptionsFinanceInput
): Promise<ListSubscriptionsFinanceOutput> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const { contaId, status, search } = input;

  const [subscriptions, standaloneSubscriptions, manualLogs] = await loadFinanceSubscriptionSources({
    contaId,
    status,
    search,
  });

  const standaloneResponsavelIds = standaloneSubscriptions
    .filter((sub) => sub.customer?.payerType === 'RESPONSAVEL' && sub.customer.payerId)
    .map((sub) => sub.customer!.payerId as string);
  const standaloneAlunoIds = standaloneSubscriptions
    .filter((sub) => sub.customer?.payerType === 'ALUNO' && sub.customer.payerId)
    .map((sub) => sub.customer!.payerId as string);

  const [standaloneResponsaveis, standaloneAlunos] = await Promise.all([
    standaloneResponsavelIds.length > 0
      ? prisma.responsavel.findMany({
          where: { id: { in: standaloneResponsavelIds } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
    standaloneAlunoIds.length > 0
      ? prisma.aluno.findMany({
          where: { id: { in: standaloneAlunoIds } },
          select: { id: true, nome: true },
        })
      : Promise.resolve([]),
  ]);

  const standaloneResponsavelMap = new Map(standaloneResponsaveis.map((item) => [item.id, item.nome]));
  const standaloneAlunoMap = new Map(standaloneAlunos.map((item) => [item.id, item.nome]));

  const itemsRaw = subscriptions.map((sub) => {
      const matricula = sub.matricula;
      const aluno = matricula.aluno;
      const responsavel = matricula.responsavelFinanceiro;
      const plano = matricula.plano;
      const combo = matricula.combo;

      const idade = calcularIdade(aluno.dataNasc);
      const isMenor = idade < 18;
      const clienteNome = isMenor
        ? responsavel?.nome ?? 'Sem responsável vinculado'
        : aluno.nome;

      const valor = plano?.valor ?? combo?.valor ?? 0;
      const periodicidade = plano?.periodicidade ?? 'MENSAL';
      const cycleLabel = CYCLE_LABELS[periodicidade] ?? periodicidade;
      const description = plano?.descricao ?? plano?.nome ?? combo?.nome ?? null;
      const billingType = matricula.formaPagamento ?? matricula.formaPagamentoTaxa ?? 'BOLETO';

      // Determinar tipo/origem
      const tipo: 'PLANO' | 'COMBO' | 'AVULSA' = plano ? 'PLANO' : combo ? 'COMBO' : 'AVULSA';

      return {
        id: sub.id,
        asaasSubscriptionId: sub.asaasSubscriptionId,
        externalReference: sub.externalReference,
        status: sub.status,
        statusLabel: STATUS_LABELS[sub.status] ?? sub.status,
        clienteNome,
        alunoNome: aluno.nome,
        alunoId: aluno.id,
        valor: Number(valor),
        cycle: String(periodicidade),
        cycleLabel,
        billingType: String(billingType),
        description,
        nextDueDate: null as string | null,
        matriculaId: matricula.id,
        createdAt: sub.createdAt.toISOString(),
        tipo,
        vencimentoDia: matricula.vencimentoDia,
      };
  });

  const manualItemsRaw = manualLogs
    .map((log) => {
      const metadata = asRecord(log.metadata);
      if (!metadata || !log.entityId) return null;

      const status = toSubscriptionStatus(metadata.status);
      const description =
        typeof metadata.description === 'string' && metadata.description.trim().length > 0
          ? metadata.description
          : null;
      const payerName =
        typeof metadata.payerName === 'string' && metadata.payerName.trim().length > 0
          ? metadata.payerName
          : 'Cliente';
      const cycle =
        typeof metadata.cycle === 'string' && metadata.cycle.trim().length > 0
          ? metadata.cycle
          : 'MONTHLY';
      const cycleLabel = CYCLE_LABELS[cycle] ?? cycle;
      const billingType =
        typeof metadata.billingType === 'string' && metadata.billingType.trim().length > 0
          ? metadata.billingType
          : 'BOLETO';
      const nextDueDate =
        typeof metadata.nextDueDate === 'string' && metadata.nextDueDate.length > 0
          ? metadata.nextDueDate
          : null;
      const asaasSubscriptionId =
        typeof metadata.asaasSubscriptionId === 'string' ? metadata.asaasSubscriptionId : null;
      const externalReference =
        typeof metadata.externalReference === 'string' ? metadata.externalReference : null;
      if (!externalReference) return null;

      const rawValue = metadata.value;
      const value =
        typeof rawValue === 'number'
          ? rawValue
          : typeof rawValue === 'string'
            ? Number(rawValue)
            : 0;
      const payerId = typeof metadata.payerId === 'string' ? metadata.payerId : log.entityId;

      return {
        id: log.entityId,
        asaasSubscriptionId,
        externalReference,
        status,
        statusLabel: STATUS_LABELS[status] ?? status,
        clienteNome: payerName,
        alunoNome: payerName,
        alunoId: payerId,
        valor: Number.isFinite(value) ? value : 0,
        cycle,
        cycleLabel,
        billingType,
        description,
        nextDueDate,
        matriculaId: '',
        createdAt: log.createdAt.toISOString(),
        tipo: 'AVULSA' as const,
        vencimentoDia: null as number | null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);

  // Mapear StandaloneSubscription da tabela real
  const standaloneIds = new Set(standaloneSubscriptions.map((s) => s.id));
  const standaloneItemsRaw = standaloneSubscriptions.map((sub) => {
    const cycleLabel = CYCLE_LABELS[sub.cycle] ?? sub.cycle;
    const payerName = sub.customer?.payerType === 'RESPONSAVEL'
      ? standaloneResponsavelMap.get(sub.customer.payerId ?? '') ?? 'Cliente'
      : standaloneAlunoMap.get(sub.customer?.payerId ?? '') ?? 'Cliente';

    return {
      id: sub.id,
      asaasSubscriptionId: sub.asaasSubscriptionId,
      externalReference: sub.externalReference,
      status: sub.status,
      statusLabel: STATUS_LABELS[sub.status] ?? sub.status,
      clienteNome: payerName,
      alunoNome: payerName,
      alunoId: sub.customerId,
      valor: Number(sub.value),
      cycle: sub.cycle,
      cycleLabel,
      billingType: sub.billingType,
      description: sub.description,
      nextDueDate: sub.nextDueDate?.toISOString().split('T')[0] ?? null,
      matriculaId: '',
      createdAt: sub.createdAt.toISOString(),
      tipo: 'AVULSA' as const,
      vencimentoDia: null as number | null,
    };
  });

  // Filtrar manualItemsRaw para remover duplicatas que já existem em standaloneItemsRaw
  const filteredManualItemsRaw = manualItemsRaw.filter((item) => !standaloneIds.has(item.id));

  let mergedItemsRaw = [...itemsRaw, ...standaloneItemsRaw, ...filteredManualItemsRaw];

  if (search) {
    const q = search.toLowerCase();
    mergedItemsRaw = mergedItemsRaw.filter((item) => {
      return (
        item.clienteNome.toLowerCase().includes(q) ||
        item.alunoNome.toLowerCase().includes(q) ||
        (item.description ?? '').toLowerCase().includes(q)
      );
    });
  }

  if (status) {
    const statusList = Array.isArray(status) ? status : [status];
    mergedItemsRaw = mergedItemsRaw.filter((item) => statusList.includes(item.status));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  mergedItemsRaw.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const total = mergedItemsRaw.length;
  const pagedRawItems = mergedItemsRaw.slice((page - 1) * pageSize, page * pageSize);

  const subRefs = pagedRawItems.map((s) => s.externalReference);
  const nextCharges = subRefs.length > 0
    ? await prisma.charge.findMany({
        where: {
          contaId,
          status: { in: ['CREATED', 'OPEN'] },
          dueDate: { gte: today },
          OR: subRefs.flatMap((ref) => ([
            { externalReference: ref },
            { externalReference: { startsWith: buildPaymentReferencePrefix(ref) } },
          ])),
        },
        orderBy: { dueDate: 'asc' },
        select: { externalReference: true, dueDate: true, value: true },
      })
    : [];

  const nextChargeMap = new Map<string, { dueDate: Date; value: number | null }>();
  for (const charge of nextCharges) {
    if (!charge.externalReference) continue;
    const matchingRef = subRefs.find((ref) => isPaymentReferenceForParent(charge.externalReference, ref));
    if (matchingRef && !nextChargeMap.has(matchingRef) && charge.dueDate) {
      nextChargeMap.set(matchingRef, {
        dueDate: charge.dueDate,
        value: charge.value != null ? Number(charge.value) : null,
      });
    }
  }

  const items: SubscriptionFinanceDTO[] = pagedRawItems.map((item) => {
    const nextCharge = nextChargeMap.get(item.externalReference);
    let nextDueDate: string | null = nextCharge?.dueDate.toISOString() ?? item.nextDueDate;
    if (!nextDueDate && item.status === 'ACTIVE') {
      const hoje = new Date();
      const diaVenc = item.vencimentoDia ?? 5;
      const proximoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, diaVenc);
      nextDueDate = proximoMes.toISOString();
    }

    const { vencimentoDia: _, ...rest } = item;
    return {
      ...rest,
      valor: nextCharge?.value ?? item.valor,
      nextDueDate,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
