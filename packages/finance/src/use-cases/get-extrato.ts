import { listFinancialTransactions as asaasListFinancialTransactions } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

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

interface FetchAllEntriesResult {
  entries: AsaasRawEntry[];
  officialTotalCount: number;
  fetchedCount: number;
  truncated: boolean;
}

export async function getExtrato(
  input: GetExtratoInput,
): Promise<Result<ExtratoResponse, GetExtratoError>> {
  const credentials = await loadAsaasCredentials(input.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  const { query } = input;

  try {
    // O extrato é sempre derivado exclusivamente do ledger oficial.
    // Nenhuma linha pode nascer de payments, subscriptions, charges ou estado local.
    const fetched = await fetchAllEntriesForPeriod(
      credentials.apiKey,
      query.startDate,
      query.endDate,
      query.direction,
    );

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
        fetchedAt: new Date().toISOString(),
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
  paymentId?: string | null;
  splitId?: string | null;
  transferId?: string | null;
  anticipationId?: string | null;
  billId?: string | null;
  invoiceId?: string | null;
  paymentDunningId?: string | null;
  creditBureauReportId?: string | null;
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
