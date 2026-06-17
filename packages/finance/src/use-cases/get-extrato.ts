import { listFinancialTransactions as asaasListFinancialTransactions } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { createHash } from 'crypto';

import type {
  ExtratoResponse,
  ExtratoQueryInput,
  LedgerEntry,
  ExtratoSummary,
} from '../dtos/ledger';
import { mapToLedgerEntry } from '../mappers/ledger.mapper';
import { enrichLedgerEntries } from '../services/ledger-enrichment.service';

export type GetExtratoError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_LISTAR_EXTRATO';

export interface GetExtratoInput {
  contaId: string;
  query: ExtratoQueryInput;
}

const MAX_ASAAS_LIMIT = 100;
const MAX_WINDOW_PAGES = 50; // hard limit: 5000 transações por período
const DEFAULT_SNAPSHOT_TTL_SECONDS = 300;

interface FetchAllEntriesResult {
  entries: AsaasRawEntry[];
  officialTotalCount: number;
  fetchedCount: number;
  truncated: boolean;
  fetchedAt?: string;
}

export async function getExtrato(
  input: GetExtratoInput,
): Promise<Result<ExtratoResponse, GetExtratoError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  const { query } = input;

  try {
    // O extrato continua derivado exclusivamente do ledger oficial. O snapshot
    // local apenas evita refetch agressivo da mesma janela operacional.
    const cached = await readSnapshotWindow(input.contaId, query);
    const fetched = cached ?? await fetchAllEntriesForPeriod(
      credentials.apiKey,
      query.startDate,
      query.endDate,
      query.direction,
    );

    if (!cached) {
      await persistSnapshotWindow(input.contaId, query, fetched).catch((error) => {
        console.warn('[finance.extrato] Falha ao persistir snapshot do ledger', {
          contaId: input.contaId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
    }

    // A normalização preserva a semântica oficial do ledger.
    const normalized: LedgerEntry[] = fetched.entries.map(mapToLedgerEntry);

    // O enriquecimento local é read-only: só acrescenta contexto operacional.
    const enriched = await enrichLedgerEntries(normalized, { contaId: input.contaId });

    // Filtros e paginação continuam operando sobre o ledger retornado pelo Asaas.
    const filtered = applyLocalFilters(enriched, query);

    // Calcular summary sobre o conjunto filtrado do período
    const summary = computeSummary(filtered);

    // Ordenar
    const sorted = applySort(filtered, query.sort, query.direction);

    // Paginar resultado final
    const startIndex = (query.page - 1) * query.pageSize;
    const paged = sorted.slice(startIndex, startIndex + query.pageSize);
    const totalItems = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));

    return ok({
      summary,
      filters: {
        startDate: query.startDate,
        endDate: query.endDate,
        type: query.type,
        status: query.status,
        search: query.search,
        sort: query.sort,
        direction: query.direction,
      },
      transactions: paged,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
        hasNextPage: query.page < totalPages,
      },
      sync: {
        provider: 'ASAAS',
        fetchedAt: fetched.fetchedAt ?? new Date().toISOString(),
        officialTotalCount: fetched.officialTotalCount,
        fetchedCount: fetched.fetchedCount,
        truncated: fetched.truncated,
        maxWindowPages: MAX_WINDOW_PAGES,
      },
    });
  } catch {
    return err('ERRO_AO_LISTAR_EXTRATO');
  }
}

// ─── Internal helpers ───

interface AsaasRawEntry {
  id: string;
  value: number;
  balance: number;
  type: string;
  date: string;
  description: string;
  externalReference?: string | null;
  paymentId?: string | null;
  splitId?: string | null;
  transferId?: string | null;
  anticipationId?: string | null;
  billId?: string | null;
  invoiceId?: string | null;
  paymentDunningId?: string | null;
  creditBureauReportId?: string | null;
}

async function readSnapshotWindow(
  contaId: string,
  query: ExtratoQueryInput,
): Promise<FetchAllEntriesResult | null> {
  const windowKey = buildSnapshotWindowKey(query);
  const minSyncedAt = new Date(Date.now() - getSnapshotTtlMs());

  const window = await prisma.financialTransactionSyncWindow.findFirst({
    where: {
      contaId,
      windowKey,
      syncedAt: { gte: minSyncedAt },
    },
  });

  if (!window) return null;

  const where: {
    contaId: string;
    date?: { gte?: Date; lte?: Date };
  } = { contaId };
  const start = parseLedgerDate(query.startDate);
  const end = parseLedgerDate(query.endDate);
  if (start || end) {
    where.date = {};
    if (start) where.date.gte = start;
    if (end) where.date.lte = end;
  }

  const rows = await prisma.financialTransactionSnapshot.findMany({
    where,
    orderBy: { date: query.direction === 'asc' ? 'asc' : 'desc' },
  });

  return {
    entries: rows.map(snapshotToRawEntry),
    officialTotalCount: window.officialTotalCount,
    fetchedCount: window.fetchedCount,
    truncated: window.truncated,
    fetchedAt: window.syncedAt.toISOString(),
  };
}

async function persistSnapshotWindow(
  contaId: string,
  query: ExtratoQueryInput,
  fetched: FetchAllEntriesResult,
): Promise<void> {
  const now = new Date();
  const windowKey = buildSnapshotWindowKey(query);

  for (let offset = 0; offset < fetched.entries.length; offset += 100) {
    const chunk = fetched.entries.slice(offset, offset + 100);
    await prisma.$transaction(chunk.map((entry) => prisma.financialTransactionSnapshot.upsert({
      where: {
        uq_fin_tx_snapshot_conta_asaas: {
          contaId,
          asaasTransactionId: entry.id,
        },
      },
      create: {
        contaId,
        asaasTransactionId: entry.id,
        value: entry.value,
        balance: entry.balance,
        type: entry.type,
        date: parseLedgerDate(entry.date) ?? now,
        description: entry.description,
        externalReference: entry.externalReference ?? null,
        paymentId: entry.paymentId ?? null,
        splitId: entry.splitId ?? null,
        transferId: entry.transferId ?? null,
        anticipationId: entry.anticipationId ?? null,
        billId: entry.billId ?? null,
        invoiceId: entry.invoiceId ?? null,
        paymentDunningId: entry.paymentDunningId ?? null,
        creditBureauReportId: entry.creditBureauReportId ?? null,
        raw: entry as unknown as object,
        fetchedAt: now,
      },
      update: {
        value: entry.value,
        balance: entry.balance,
        type: entry.type,
        date: parseLedgerDate(entry.date) ?? now,
        description: entry.description,
        externalReference: entry.externalReference ?? null,
        paymentId: entry.paymentId ?? null,
        splitId: entry.splitId ?? null,
        transferId: entry.transferId ?? null,
        anticipationId: entry.anticipationId ?? null,
        billId: entry.billId ?? null,
        invoiceId: entry.invoiceId ?? null,
        paymentDunningId: entry.paymentDunningId ?? null,
        creditBureauReportId: entry.creditBureauReportId ?? null,
        raw: entry as unknown as object,
        fetchedAt: now,
      },
    })));
  }

  await prisma.financialTransactionSyncWindow.upsert({
    where: {
      uq_fin_tx_sync_window_conta_key: {
        contaId,
        windowKey,
      },
    },
    create: {
      contaId,
      windowKey,
      startDate: query.startDate ?? null,
      finishDate: query.endDate ?? null,
      order: query.direction,
      syncedAt: now,
      officialTotalCount: fetched.officialTotalCount,
      fetchedCount: fetched.fetchedCount,
      truncated: fetched.truncated,
    },
    update: {
      startDate: query.startDate ?? null,
      finishDate: query.endDate ?? null,
      order: query.direction,
      syncedAt: now,
      officialTotalCount: fetched.officialTotalCount,
      fetchedCount: fetched.fetchedCount,
      truncated: fetched.truncated,
    },
  });
}

function snapshotToRawEntry(row: {
  asaasTransactionId: string;
  value: unknown;
  balance: unknown | null;
  type: string;
  date: Date;
  description: string;
  externalReference: string | null;
  paymentId: string | null;
  splitId: string | null;
  transferId: string | null;
  anticipationId: string | null;
  billId: string | null;
  invoiceId: string | null;
  paymentDunningId: string | null;
  creditBureauReportId: string | null;
}): AsaasRawEntry {
  return {
    id: row.asaasTransactionId,
    value: Number(row.value),
    balance: row.balance === null ? 0 : Number(row.balance),
    type: row.type,
    date: row.date.toISOString().slice(0, 10),
    description: row.description,
    externalReference: row.externalReference,
    paymentId: row.paymentId,
    splitId: row.splitId,
    transferId: row.transferId,
    anticipationId: row.anticipationId,
    billId: row.billId,
    invoiceId: row.invoiceId,
    paymentDunningId: row.paymentDunningId,
    creditBureauReportId: row.creditBureauReportId,
  };
}

function buildSnapshotWindowKey(query: ExtratoQueryInput): string {
  const raw = JSON.stringify({
    startDate: query.startDate ?? null,
    endDate: query.endDate ?? null,
    direction: query.direction,
  });
  return createHash('sha256').update(raw).digest('hex');
}

function getSnapshotTtlMs(): number {
  const seconds = Number(process.env.FINANCE_EXTRATO_SNAPSHOT_TTL_SECONDS ?? DEFAULT_SNAPSHOT_TTL_SECONDS);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_SNAPSHOT_TTL_SECONDS) * 1000;
}

function parseLedgerDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchAllEntriesForPeriod(
  apiKey: string,
  startDate?: string,
  finishDate?: string,
  order?: 'asc' | 'desc',
): Promise<FetchAllEntriesResult> {
  const all: AsaasRawEntry[] = [];
  let offset = 0;
  let pages = 0;
  let officialTotalCount = 0;
  let hasMore = false;

  while (true) {
    if (pages >= MAX_WINDOW_PAGES) break;

    const response = await asaasListFinancialTransactions({
      apiKey,
      offset,
      limit: MAX_ASAAS_LIMIT,
      startDate,
      finishDate,
      order,
    });

    officialTotalCount = response.totalCount;
    hasMore = response.hasMore;
    all.push(...response.data);
    pages++;

    if (!response.hasMore) break;
    offset += MAX_ASAAS_LIMIT;
  }

  return {
    entries: all,
    officialTotalCount,
    fetchedCount: all.length,
    truncated: hasMore,
  };
}

function applyLocalFilters(
  entries: LedgerEntry[],
  query: ExtratoQueryInput,
): LedgerEntry[] {
  let result = entries;

  if (query.type && query.type.length > 0) {
    const typeSet = new Set(query.type);
    result = result.filter((e) => typeSet.has(e.type));
  }

  if (query.status && query.status.length > 0) {
    const statusSet = new Set(query.status);
    result = result.filter((e) => statusSet.has(e.status));
  }

  if (query.search) {
    const term = query.search.toLowerCase();
    result = result.filter((e) =>
      e.description.toLowerCase().includes(term)
      || (e.chargeName && e.chargeName.toLowerCase().includes(term))
      || (e.customerName && e.customerName.toLowerCase().includes(term))
      || (e.paymentId && e.paymentId.toLowerCase().includes(term))
      || (e.transferId && e.transferId.toLowerCase().includes(term))
      || (e.invoiceId && e.invoiceId.toLowerCase().includes(term))
      || (e.billId && e.billId.toLowerCase().includes(term))
      || (e.paymentDunningId && e.paymentDunningId.toLowerCase().includes(term))
      || (e.creditBureauReportId && e.creditBureauReportId.toLowerCase().includes(term))
      || (e.externalReference && e.externalReference.toLowerCase().includes(term))
      || (e.metadata?.transferExternalReference
        && e.metadata.transferExternalReference.toLowerCase().includes(term))
      || false,
    );
  }

  return result;
}

function computeSummary(entries: LedgerEntry[]): ExtratoSummary {
  let receitas = 0;
  let despesas = 0;
  let estornos = 0;
  let liquido = 0;

  for (const entry of entries) {
    liquido += entry.grossValue;

    switch (entry.type) {
      case 'RECEITA':
        receitas += Math.max(entry.grossValue, 0);
        break;
      case 'ESTORNO':
        estornos += Math.abs(entry.grossValue);
        break;
      case 'TAXA':
      case 'TRANSFERENCIA':
      case 'ANTECIPACAO':
      case 'AJUSTE':
        if (entry.grossValue < 0) {
          despesas += Math.abs(entry.grossValue);
        }
        break;
    }
  }

  return {
    receitas: Number(receitas.toFixed(2)),
    despesas: Number(despesas.toFixed(2)),
    estornos: Number(estornos.toFixed(2)),
    liquido: Number(liquido.toFixed(2)),
  };
}

function applySort(
  entries: LedgerEntry[],
  sort: string,
  direction: 'asc' | 'desc',
): LedgerEntry[] {
  const sorted = [...entries];
  const dir = direction === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sort) {
      case 'grossValue':
        return (a.grossValue - b.grossValue) * dir;
      case 'type':
        return a.type.localeCompare(b.type) * dir;
      case 'date':
      default:
        return a.date.localeCompare(b.date) * dir;
    }
  });

  return sorted;
}
