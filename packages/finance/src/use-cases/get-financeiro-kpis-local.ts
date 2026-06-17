import { prisma } from '@alusa/database';
import type { ChargeStatus, Prisma, PrismaClient, StatusCobranca } from '@prisma/client';

import type {
  FinanceiroKpiSnapshot,
  FinanceiroKpisSnapshot,
} from './get-financeiro-kpis-from-asaas';

type FinanceDbClient = PrismaClient | Prisma.TransactionClient;

export type GetFinanceiroKpisLocalInput = {
  contaId: string;
  mesAtual: Date;
  proximoMes: Date;
  startOfToday: Date;
  endOfNext30Days: Date;
  db?: FinanceDbClient;
};

export type GetFinanceiroKpisLocalOutput = {
  data: FinanceiroKpisSnapshot;
};

type KpiBucket = FinanceiroKpiSnapshot & {
  customerKeys: Set<string>;
};

type LocalPaymentCategory =
  | 'recebidas'
  | 'recebidasEmDinheiro'
  | 'confirmadas'
  | 'aguardandoPagamento'
  | 'vencidas'
  | 'ignored';
type CountedPaymentCategory = Exclude<LocalPaymentCategory, 'ignored'>;

type LocalPaymentCandidate = {
  id: string;
  customerKey: string;
  value: number;
  netValue: number;
  category: CountedPaymentCategory;
  paidAt: Date | null;
};

const ACADEMIC_ACTIVE_STATUSES: StatusCobranca[] = [
  'A_VENCER',
  'PENDENTE',
  'PROCESSANDO',
  'PAGO',
  'ATRASADO',
];

const STANDALONE_ACTIVE_STATUSES: ChargeStatus[] = [
  'CREATED',
  'PENDING_SYNC',
  'OPEN',
  'PAID',
  'OVERDUE',
];

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function emptyBucket(): KpiBucket {
  return {
    valorBruto: 0,
    valorLiquido: 0,
    quantidadeDeCobrancas: 0,
    quantidadeDeClientes: 0,
    customerKeys: new Set(),
  };
}

function finalizeBucket(bucket: KpiBucket): FinanceiroKpiSnapshot {
  return {
    valorBruto: roundCurrency(bucket.valorBruto),
    valorLiquido: roundCurrency(bucket.valorLiquido),
    quantidadeDeCobrancas: bucket.quantidadeDeCobrancas,
    quantidadeDeClientes: bucket.customerKeys.size,
  };
}

function addToBucket(bucket: KpiBucket, candidate: LocalPaymentCandidate): void {
  bucket.valorBruto += candidate.value;
  bucket.valorLiquido += candidate.netValue;
  bucket.quantidadeDeCobrancas += 1;
  bucket.customerKeys.add(candidate.customerKey);
}

function numberFromDecimal(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function isWithin(date: Date | null, start: Date, endExclusive: Date): boolean {
  return Boolean(date && date >= start && date < endExclusive);
}

function normalizeAsaasStatus(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function resolveAcademicCategory(input: {
  localStatus: StatusCobranca;
  asaasStatus: string | null;
  liquidacaoStatus?: string | null;
  dueDate: Date;
  startOfToday: Date;
  endOfNext30Days: Date;
}): LocalPaymentCategory {
  switch (input.asaasStatus) {
    case 'RECEIVED_IN_CASH':
      return 'recebidasEmDinheiro';
    case 'RECEIVED':
      return 'recebidas';
    case 'CONFIRMED':
      return 'confirmadas';
    case 'OVERDUE':
      return 'vencidas';
    case 'PENDING':
      return input.dueDate >= input.startOfToday && input.dueDate <= input.endOfNext30Days
        ? 'aguardandoPagamento'
        : 'ignored';
    default:
      break;
  }

  if (input.localStatus === 'PAGO') {
    return input.liquidacaoStatus === 'PENDENTE' ? 'confirmadas' : 'recebidas';
  }

  if (input.localStatus === 'ATRASADO' || input.dueDate < input.startOfToday) {
    return 'vencidas';
  }

  if (['A_VENCER', 'PENDENTE', 'PROCESSANDO'].includes(input.localStatus)) {
    return input.dueDate >= input.startOfToday && input.dueDate <= input.endOfNext30Days
      ? 'aguardandoPagamento'
      : 'ignored';
  }

  return 'ignored';
}

function resolveStandaloneCategory(input: {
  localStatus: ChargeStatus;
  asaasStatus: string | null;
  liquidacaoStatus?: string | null;
  billingType?: string | null;
  dueDate: Date | null;
  startOfToday: Date;
  endOfNext30Days: Date;
}): LocalPaymentCategory {
  switch (input.asaasStatus) {
    case 'RECEIVED_IN_CASH':
      return 'recebidasEmDinheiro';
    case 'RECEIVED':
      return 'recebidas';
    case 'CONFIRMED':
      return 'confirmadas';
    case 'OVERDUE':
      return 'vencidas';
    case 'PENDING':
      return input.dueDate && input.dueDate >= input.startOfToday && input.dueDate <= input.endOfNext30Days
        ? 'aguardandoPagamento'
        : 'ignored';
    default:
      break;
  }

  if (input.localStatus === 'PAID') {
    if (input.billingType === 'RECEIVED_IN_CASH') return 'recebidasEmDinheiro';
    return input.liquidacaoStatus === 'PENDENTE' ? 'confirmadas' : 'recebidas';
  }

  if (input.localStatus === 'OVERDUE' || (input.dueDate && input.dueDate < input.startOfToday)) {
    return 'vencidas';
  }

  if (['CREATED', 'PENDING_SYNC', 'OPEN'].includes(input.localStatus)) {
    return input.dueDate && input.dueDate >= input.startOfToday && input.dueDate <= input.endOfNext30Days
      ? 'aguardandoPagamento'
      : 'ignored';
  }

  return 'ignored';
}

const kpiLocalInflight = new Map<string, Promise<GetFinanceiroKpisLocalOutput>>();

function buildKpiLocalInflightKey(input: GetFinanceiroKpisLocalInput) {
  return [
    input.contaId,
    input.mesAtual.toISOString(),
    input.proximoMes.toISOString(),
    input.startOfToday.toISOString(),
    input.endOfNext30Days.toISOString(),
  ].join(':');
}

async function computeFinanceiroKpisLocal(
  input: GetFinanceiroKpisLocalInput,
): Promise<GetFinanceiroKpisLocalOutput> {
  const db = input.db ?? prisma;

  const [academicCharges, standaloneCharges] = await Promise.all([
    db.cobranca.findMany({
      where: {
        contaId: input.contaId,
        status: { in: ACADEMIC_ACTIVE_STATUSES },
      },
      select: {
        id: true,
        valor: true,
        valorFinal: true,
        dataPagamento: true,
        pagoEm: true,
        updatedAt: true,
        vencimento: true,
        status: true,
        formaPagamento: true,
        asaasStatus: true,
        asaasValue: true,
        asaasNetValue: true,
        liquidacaoStatus: true,
        matricula: { select: { alunoId: true } },
      },
    }),
    db.charge.findMany({
      where: {
        contaId: input.contaId,
        cobrancaId: null,
        status: { in: STANDALONE_ACTIVE_STATUSES },
      },
      select: {
        id: true,
        value: true,
        updatedAt: true,
        statusUpdatedAt: true,
        dueDate: true,
        status: true,
        asaasStatus: true,
        asaasValue: true,
        asaasNetValue: true,
        liquidacaoStatus: true,
        liquidadoEm: true,
        billingType: true,
        customerId: true,
        payerName: true,
      },
    }),
  ]);

  const buckets = {
    recebidas: emptyBucket(),
    recebidasEmDinheiro: emptyBucket(),
    confirmadas: emptyBucket(),
    aguardandoPagamento: emptyBucket(),
    vencidas: emptyBucket(),
    receitaDoMes: emptyBucket(),
  };

  const candidates: LocalPaymentCandidate[] = [];

  for (const charge of academicCharges) {
    const category = resolveAcademicCategory({
      localStatus: charge.status,
      asaasStatus: normalizeAsaasStatus(charge.asaasStatus),
      liquidacaoStatus: charge.liquidacaoStatus,
      dueDate: charge.vencimento,
      startOfToday: input.startOfToday,
      endOfNext30Days: input.endOfNext30Days,
    });

    if (category === 'ignored') continue;

    const paidAt = charge.dataPagamento ?? charge.pagoEm ?? charge.updatedAt ?? null;
    if (
      (category === 'recebidas' || category === 'recebidasEmDinheiro') &&
      !isWithin(paidAt, input.mesAtual, input.proximoMes)
    ) {
      continue;
    }

    const value = numberFromDecimal(charge.asaasValue ?? charge.valorFinal ?? charge.valor);
    const netValue = numberFromDecimal(charge.asaasNetValue ?? charge.asaasValue ?? charge.valorFinal ?? charge.valor);
    candidates.push({
      id: charge.id,
      category,
      value,
      netValue,
      customerKey: charge.matricula?.alunoId ?? charge.id,
      paidAt,
    });
  }

  for (const charge of standaloneCharges) {
    const category = resolveStandaloneCategory({
      localStatus: charge.status,
      asaasStatus: normalizeAsaasStatus(charge.asaasStatus),
      liquidacaoStatus: charge.liquidacaoStatus,
      billingType: charge.billingType,
      dueDate: charge.dueDate,
      startOfToday: input.startOfToday,
      endOfNext30Days: input.endOfNext30Days,
    });

    if (category === 'ignored') continue;

    const paidAt = charge.liquidadoEm ?? charge.statusUpdatedAt ?? charge.updatedAt ?? null;
    if (
      (category === 'recebidas' || category === 'recebidasEmDinheiro') &&
      !isWithin(paidAt, input.mesAtual, input.proximoMes)
    ) {
      continue;
    }

    const value = numberFromDecimal(charge.asaasValue ?? charge.value);
    const netValue = numberFromDecimal(charge.asaasNetValue ?? charge.asaasValue ?? charge.value);
    candidates.push({
      id: charge.id,
      category,
      value,
      netValue,
      customerKey: charge.customerId ?? charge.payerName ?? charge.id,
      paidAt,
    });
  }

  for (const candidate of candidates) {
    addToBucket(buckets[candidate.category], candidate);

    if (
      (candidate.category === 'recebidas' || candidate.category === 'recebidasEmDinheiro') &&
      isWithin(candidate.paidAt, input.mesAtual, input.proximoMes)
    ) {
      addToBucket(buckets.receitaDoMes, candidate);
    }
  }

  const recebidas = finalizeBucket(buckets.recebidas);
  const recebidasEmDinheiro = finalizeBucket(buckets.recebidasEmDinheiro);
  const confirmadas = finalizeBucket(buckets.confirmadas);
  const aguardandoPagamento = finalizeBucket(buckets.aguardandoPagamento);
  const vencidas = finalizeBucket(buckets.vencidas);
  const receitaDoMes = finalizeBucket(buckets.receitaDoMes);

  const totalEmAberto =
    aguardandoPagamento.quantidadeDeCobrancas + vencidas.quantidadeDeCobrancas;
  const taxaInadimplencia = totalEmAberto > 0
    ? (vencidas.quantidadeDeCobrancas / totalEmAberto) * 100
    : 0;

  return {
    data: {
      recebidas,
      recebidasEmDinheiro,
      confirmadas,
      aguardandoPagamento,
      vencidas,
      receitaDoMes: {
        ...receitaDoMes,
        periodo: {
          inicio: input.mesAtual.toISOString(),
          fim: input.proximoMes.toISOString(),
        },
      },
      resumo: {
        totalReceitaReal: roundCurrency(receitaDoMes.valorLiquido),
        totalAReceber: roundCurrency(aguardandoPagamento.valorBruto + confirmadas.valorBruto),
        totalInadimplente: roundCurrency(vencidas.valorBruto),
        taxaInadimplencia: roundCurrency(taxaInadimplencia),
      },
    },
  };
}

export async function getFinanceiroKpisLocal(
  input: GetFinanceiroKpisLocalInput,
): Promise<GetFinanceiroKpisLocalOutput> {
  const key = buildKpiLocalInflightKey(input);
  const inflight = kpiLocalInflight.get(key);
  if (inflight) return inflight;

  const promise = computeFinanceiroKpisLocal(input).finally(() => {
    if (kpiLocalInflight.get(key) === promise) {
      kpiLocalInflight.delete(key);
    }
  });
  kpiLocalInflight.set(key, promise);
  return promise;
}
