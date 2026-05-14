'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ReceiptText } from 'lucide-react';

import { Download, Filter, Search } from '@/components/icons/icons';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import type { GetAccountBalanceSummaryOutput } from '@alusa/finance';

import { useFinanceLiveRefresh } from '../hooks/useFinanceLiveRefresh';
import { formatCurrency, formatDate } from '../extrato/utils/extrato-formatters';
import {
  TransferWizardDialog,
  type TransferRecipient,
} from './transfer-wizards';

type TransferStatus = 'REQUESTED' | 'PENDING' | 'BLOCKED' | 'PROCESSING' | 'DONE' | 'CANCELED' | 'FAILED';

type TransfersResponse = {
  items: Array<{
    id: string;
    externalReference: string;
    amount: string;
    feeAmount: string | null;
    netAmount: string;
    status: TransferStatus;
    operation: 'PIX' | 'TED';
    recipientName: string | null;
    cpfCnpj: string | null;
    bankName: string | null;
    description: string | null;
    scheduleDate: string | null;
    transferDate: string | null;
    createdAt: string;
    statusUpdatedAt: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type TransferFiltersState = {
  search: string;
  direction: 'asc' | 'desc';
  status: 'ALL' | TransferStatus;
  operation: 'ALL' | 'PIX' | 'TED';
  from: string;
  to: string;
};

const ACCOUNT_SUMMARY_URL = '/api/financeiro/conta?mode=summary';
const inFlightGetRequests = new Map<string, Promise<unknown>>();

function sanitizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Não foi possível concluir a operação.';
}

function mapCancelTransferErrorMessage(message: string) {
  switch (message) {
    case 'TRANSFER_NAO_CANCELAVEL':
      return 'A transferência já foi concluída ou não pode mais ser cancelada.';
    case 'TRANSFER_SEM_ID_ASAAS':
      return 'A transferência ainda não possui identificador externo para cancelamento.';
    case 'TRANSFER_NAO_ENCONTRADA':
      return 'A transferência não foi encontrada.';
    case 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS':
      return 'A conta financeira ainda não está configurada para cancelar esta transferência.';
    default:
      return message;
  }
}

function mapTransferStatus(status: TransferStatus) {
  switch (status) {
    case 'DONE':
      return { label: 'Concluída', variant: 'success' as const };
    case 'FAILED':
      return { label: 'Falhou', variant: 'destructive' as const };
    case 'BLOCKED':
      return { label: 'Bloqueada', variant: 'destructive' as const };
    case 'PROCESSING':
      return { label: 'Processando', variant: 'info' as const };
    case 'CANCELED':
      return { label: 'Cancelada', variant: 'neutral' as const };
    case 'REQUESTED':
      return { label: 'Solicitada', variant: 'warning' as const };
    case 'PENDING':
    default:
      return { label: 'Pendente', variant: 'warning' as const };
  }
}

function canCancelTransfer(status: TransferStatus) {
  // PROCESSING = BANK_PROCESSING no Asaas — não pode ser cancelado nesse estágio
  return status === 'REQUESTED' || status === 'PENDING' || status === 'BLOCKED';
}

function formatTableDate(value: string | null | undefined) {
  if (!value) return '—';

  const normalized = value.trim();
  const datePart = normalized.slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? formatDate(datePart) : '—';
}

function compactPersonName(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return '—';

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return normalized;

  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function formatTransferOperation(operation: 'PIX' | 'TED') {
  return operation === 'PIX' ? 'Pix' : 'Ted';
}

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function formatOfficialFee(value: string | null | undefined) {
  if (value === null || value === undefined) return '—';

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '—';

  return formatCurrency(numericValue);
}

function buildTransfersQuery(page: number, filters: TransferFiltersState) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    direction: filters.direction,
  });

  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status !== 'ALL') params.set('status', filters.status);
  if (filters.operation !== 'ALL') params.set('operation', filters.operation);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);

  return params.toString();
}

async function exportTransfersPdf(data: TransfersResponse) {
  const [{ default: jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  doc.setFontSize(18);
  doc.text('Transferências da conta', 40, 52);
  doc.setFontSize(10);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 40, 72);

  autoTable(doc, {
    startY: 92,
    head: [[
      'Solicitação',
      'Agendada para',
      'Data da transferência',
      'Operação',
      'Nome',
      'CPF ou CNPJ',
      'Banco',
      'Taxa',
      'Valor enviado',
      'Situação',
    ]],
    body: data.items.map((item) => [
      formatTableDate(item.createdAt),
      formatTableDate(item.scheduleDate),
      formatTableDate(item.transferDate),
      formatTransferOperation(item.operation),
      compactPersonName(item.recipientName ?? item.description),
      item.cpfCnpj ?? '—',
      item.bankName ?? '—',
      formatOfficialFee(item.feeAmount),
      formatCurrency(Number(item.amount)),
      mapTransferStatus(item.status).label,
    ]),
    styles: {
      fontSize: 8,
      cellPadding: 5,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [29, 78, 216],
    },
    margin: { left: 28, right: 28 },
  });

  doc.save(`transferencias-conta-${sanitizeFileName(new Date().toISOString().slice(0, 10))}.pdf`);
}

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: unknown };

  if (!response.ok) {
    const errorMessage =
      typeof json.error === 'string'
        ? json.error
        : typeof json.error === 'object' && json.error && 'message' in json.error
          ? String((json.error as { message?: string }).message)
          : `Erro ${response.status}`;
    throw new Error(errorMessage);
  }

  return json.data as T;
}

async function readJsonDeduped<T>(input: string): Promise<T> {
  const existing = inFlightGetRequests.get(input);
  if (existing) return existing as Promise<T>;

  const request = readJson<T>(input).finally(() => {
    inFlightGetRequests.delete(input);
  });
  inFlightGetRequests.set(input, request);
  return request;
}

function getAccountSummaryUrl(opts: { bypassCache?: boolean } = {}) {
  return opts.bypassCache ? `${ACCOUNT_SUMMARY_URL}&bypassCache=1` : ACCOUNT_SUMMARY_URL;
}

function ContaSkeleton() {
  return (
    <div className="space-y-5 pr-4 xl:pr-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-36" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-10 w-44" />
        <Skeleton className="mt-3 h-4 w-60" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-4 w-72" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}


function TransferTableSection({
  data,
  loading,
  onPageChange,
  onRequestCancel,
  onViewTransfer,
  filters,
  onFiltersChange,
  onClearFilters,
  onExport,
  exporting,
}: {
  data: TransfersResponse | null;
  loading: boolean;
  onPageChange: (page: number) => void;
  onRequestCancel: (transfer: TransfersResponse['items'][number]) => void;
  onViewTransfer: (transfer: TransfersResponse['items'][number]) => void;
  filters: TransferFiltersState;
  onFiltersChange: (patch: Partial<TransferFiltersState>) => void;
  onClearFilters: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const activeCount = [
    Boolean(filters.search.trim()),
    filters.status !== 'ALL',
    filters.operation !== 'ALL',
    Boolean(filters.from),
    Boolean(filters.to),
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-slate-100 bg-gray-50 px-4 py-4 md:px-5">
        <p className="text-sm font-semibold text-slate-900">Saídas e transferências</p>
        <p className="text-xs text-slate-500">
          Acompanhe as movimentações enviadas pela sua conta, consulte o status de cada transferência e cancele quando a operação ainda permitir.
        </p>
      </div>

      <div className="border-b border-slate-100 bg-[#F8FAFC] p-4 md:p-5">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className="relative w-full max-w-xl">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder="Buscar por nome ou documento do titular"
                value={filters.search}
                onChange={(event) => onFiltersChange({ search: event.target.value })}
                className="h-10 rounded-xl border-slate-200 bg-white pl-9"
              />
            </div>

            <div className="flex max-lg:flex-col flex-wrap items-stretch gap-3 lg:items-center">
              <Select value={filters.direction} onValueChange={(value) => onFiltersChange({ direction: value as 'asc' | 'desc' })}>
                <SelectTrigger className="h-10 w-full min-w-0 rounded-xl border-slate-200 bg-white lg:w-[170px]">
                  <SelectValue placeholder="Ordem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Mais recente</SelectItem>
                  <SelectItem value="asc">Mais antigo</SelectItem>
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="relative h-10 w-full rounded-xl border-slate-200 bg-white px-4 lg:w-auto">
                    <Filter className="mr-2 h-4 w-4" />
                    Filtros avançados
                    {activeCount > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
                        {activeCount}
                      </span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 rounded-xl border-slate-200 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.12)]" align="end" sideOffset={10}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-900">Refinar transferências</h4>
                      {activeCount > 0 ? (
                        <button type="button" onClick={onClearFilters} className="text-xs font-medium text-slate-600 hover:text-slate-900">
                          Limpar tudo
                        </button>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">Data inicial</label>
                        <Input
                          type="date"
                          value={filters.from}
                          onChange={(event) => onFiltersChange({ from: event.target.value })}
                          className="h-9 rounded-xl border-slate-200 bg-white"
                          max={filters.to || undefined}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">Data final</label>
                        <Input
                          type="date"
                          value={filters.to}
                          onChange={(event) => onFiltersChange({ to: event.target.value })}
                          className="h-9 rounded-xl border-slate-200 bg-white"
                          min={filters.from || undefined}
                        />
                      </div>

                      <div className="space-y-1.5 border-t border-slate-100 pt-3">
                        <label className="text-xs font-medium text-gray-500">Operação</label>
                        <Select value={filters.operation} onValueChange={(value) => onFiltersChange({ operation: value as TransferFiltersState['operation'] })}>
                          <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 bg-white">
                            <SelectValue placeholder="Todas" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">Todas</SelectItem>
                            <SelectItem value="PIX">Pix</SelectItem>
                            <SelectItem value="TED">Ted</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">Situação</label>
                        <Select value={filters.status} onValueChange={(value) => onFiltersChange({ status: value as TransferFiltersState['status'] })}>
                          <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 bg-white">
                            <SelectValue placeholder="Todas" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">Todas</SelectItem>
                            <SelectItem value="REQUESTED">Solicitada</SelectItem>
                            <SelectItem value="PENDING">Pendente</SelectItem>
                            <SelectItem value="BLOCKED">Bloqueada</SelectItem>
                            <SelectItem value="PROCESSING">Processando</SelectItem>
                            <SelectItem value="DONE">Efetuada</SelectItem>
                            <SelectItem value="CANCELED">Cancelada</SelectItem>
                            <SelectItem value="FAILED">Falhou</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <Button onClick={onExport} disabled={exporting || !data?.items.length} className="h-10 w-full rounded-xl bg-[#A78BFA] px-4 text-white hover:bg-[#8B5CF6] disabled:bg-[#DDD6FE] lg:w-auto">
                <Download className="mr-2 h-4 w-4" />
                {exporting ? 'Exportando...' : 'Exportar Dados'}
              </Button>
            </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 lg:px-6">
                Solicitação
              </th>
              <th className="hidden px-6 py-3 text-left text-xs font-medium text-gray-500 lg:table-cell">
                Agendada para
              </th>
              <th className="hidden px-6 py-3 text-left text-xs font-medium text-gray-500 lg:table-cell">
                Data da transferência
              </th>
              <th className="hidden px-6 py-3 text-left text-xs font-medium text-gray-500 lg:table-cell">
                Operação
              </th>
              <th className="hidden px-6 py-3 text-left text-xs font-medium text-gray-500 lg:table-cell">
                Nome
              </th>
              <th className="hidden px-6 py-3 text-left text-xs font-medium text-gray-500 lg:table-cell">
                CPF ou CNPJ
              </th>
              <th className="hidden px-6 py-3 text-left text-xs font-medium text-gray-500 lg:table-cell">
                Banco
              </th>
              <th className="hidden px-6 py-3 text-right text-xs font-medium text-gray-500 lg:table-cell">
                Taxa
              </th>
              <th className="hidden px-6 py-3 text-right text-xs font-medium text-gray-500 lg:table-cell">
                Valor enviado
              </th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 lg:px-6">
                Situação
              </th>
              <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 lg:px-6">
                Acoes
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {loading ? (
              <tr>
                <td className="px-6 py-8 text-center text-sm text-gray-500" colSpan={11}>
                  Carregando transferências...
                </td>
              </tr>
            ) : data?.items.length ? (
              data.items.map((item) => {
                const status = mapTransferStatus(item.status);
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer transition-colors hover:bg-gray-50 focus-within:bg-gray-50"
                    onClick={() => onViewTransfer(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onViewTransfer(item);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Abrir detalhes da transferência ${item.externalReference}`}
                  >
                    <td className="px-3 py-4 text-sm text-slate-700 lg:px-6">
                      <span className="font-medium">{formatTableDate(item.createdAt)}</span>
                      <div className="mt-1.5 space-y-1 text-xs text-slate-600 lg:hidden">
                        <div>Agend.: {formatTableDate(item.scheduleDate)}</div>
                        <div>Transferido: {formatTableDate(item.transferDate)}</div>
                        <div>{formatTransferOperation(item.operation)}</div>
                        <div className="font-medium text-slate-900">
                          {compactPersonName(item.recipientName ?? item.description)}
                        </div>
                        {item.cpfCnpj ? <div className="font-mono text-[11px]">{item.cpfCnpj}</div> : null}
                        {item.bankName ? <div className="truncate">{item.bankName}</div> : null}
                        <div>
                          {formatCurrency(Number(item.amount))}
                          {item.feeAmount != null && Number(item.feeAmount) > 0 ? (
                            <span className="text-slate-500"> · taxa {formatOfficialFee(item.feeAmount)}</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-6 py-4 text-sm text-slate-700 lg:table-cell">{formatTableDate(item.scheduleDate)}</td>
                    <td className="hidden px-6 py-4 text-sm text-slate-700 lg:table-cell">{formatTableDate(item.transferDate)}</td>
                    <td className="hidden px-6 py-4 text-sm text-slate-700 lg:table-cell">{formatTransferOperation(item.operation)}</td>
                    <td className="hidden px-6 py-4 text-sm font-medium text-slate-900 lg:table-cell">{compactPersonName(item.recipientName ?? item.description)}</td>
                    <td className="hidden px-6 py-4 text-sm text-slate-700 lg:table-cell">{item.cpfCnpj ?? '—'}</td>
                    <td className="hidden px-6 py-4 text-sm text-slate-700 lg:table-cell">{item.bankName ?? '—'}</td>
                    <td className="hidden px-6 py-4 text-right text-sm text-slate-700 lg:table-cell">
                      {formatOfficialFee(item.feeAmount)}
                    </td>
                    <td className="hidden px-6 py-4 text-right text-sm text-slate-700 lg:table-cell">
                      {formatCurrency(Number(item.amount))}
                    </td>
                    <td className="px-3 py-4 text-center lg:px-6">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-2 py-4 text-center lg:px-6">
                      {canCancelTransfer(item.status) ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 max-lg:px-2 max-lg:text-[11px] text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRequestCancel(item);
                          }}
                        >
                          Cancelar
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="px-6 py-10 text-center text-sm text-slate-500" colSpan={11}>
                  Nenhuma transferência encontrada para esta conta.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 ? (
        <div
          className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"
          role="navigation"
        >
          <span className="text-xs font-medium text-gray-500">
            Página {data.page} de {data.totalPages} - {data.total} transferência(s)
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={data.page <= 1}
              onClick={() => onPageChange(data.page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={data.page >= data.totalPages}
              onClick={() => onPageChange(data.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ContaPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<GetAccountBalanceSummaryOutput | null>(null);
  const [recipients, setRecipients] = useState<TransferRecipient[]>([]);
  const [transfers, setTransfers] = useState<TransfersResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferToCancel, setTransferToCancel] = useState<TransfersResponse['items'][number] | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [prefilledRecipient, setPrefilledRecipient] = useState<TransferRecipient | null>(null);
  const [filters, setFilters] = useState<TransferFiltersState>({
    search: '',
    direction: 'desc',
    status: 'ALL',
    operation: 'ALL',
    from: '',
    to: '',
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [filters.search]);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const loadTransfers = useCallback(async (nextPage: number) => {
    const query = buildTransfersQuery(nextPage, effectiveFilters);
    const data = await readJsonDeduped<TransfersResponse>(`/api/finance/transfers?${query}`);
    setTransfers(data);
    setPage(data.page);
  }, [effectiveFilters]);

  const loadOverviewAndRecipients = useCallback(async (opts: { bypassCache?: boolean } = {}) => {
    const [overviewData, recipientsData] = await Promise.all([
      opts.bypassCache
        ? readJson<GetAccountBalanceSummaryOutput>(getAccountSummaryUrl({ bypassCache: true }))
        : readJsonDeduped<GetAccountBalanceSummaryOutput>(getAccountSummaryUrl()),
      readJsonDeduped<{ items: TransferRecipient[] }>('/api/finance/transfers/recipients').catch(() => ({ items: [] })),
    ]);

    setOverview(overviewData);
    setRecipients(recipientsData.items);
  }, []);

  const refreshOverview = useCallback(async (opts: { bypassCache?: boolean } = {}) => {
    const data = opts.bypassCache
      ? await readJson<GetAccountBalanceSummaryOutput>(getAccountSummaryUrl({ bypassCache: true }))
      : await readJsonDeduped<GetAccountBalanceSummaryOutput>(getAccountSummaryUrl());
    setOverview(data);
  }, []);

  const loadInitialData = useCallback(async (nextPage = 1) => {
    try {
      if (nextPage === 1) {
        setLoading(true);
      } else {
        setTableLoading(true);
      }

      setError(null);

      await Promise.all([loadOverviewAndRecipients(), loadTransfers(nextPage)]);
    } catch (err) {
      setError('Não foi possível carregar a conta');
      console.error('[ContaPage] loadInitialData', err);
    } finally {
      setLoading(false);
      setTableLoading(false);
    }
  }, [loadOverviewAndRecipients, loadTransfers]);

  useEffect(() => {
    void loadInitialData(1);
  }, [loadInitialData]);

  useFinanceLiveRefresh(
    () => refreshOverview().catch((error) => {
      console.error('[ContaPage] refreshOverview', error);
    }),
    { intervalMs: 30_000, minIntervalMs: 8_000 },
  );

  const refreshCurrentView = useCallback(async () => {
    await Promise.all([loadOverviewAndRecipients({ bypassCache: true }), loadTransfers(page)]);
  }, [loadOverviewAndRecipients, loadTransfers, page]);

  const handleFiltersChange = useCallback((patch: Partial<TransferFiltersState>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      search: '',
      direction: 'desc',
      status: 'ALL',
      operation: 'ALL',
      from: '',
      to: '',
    });
    setDebouncedSearch('');
    setPage(1);
  }, []);

  const handleExportTransfers = useCallback(async () => {
    if (!transfers?.items.length) return;

    setExporting(true);
    try {
      await exportTransfersPdf(transfers);
    } catch (error) {
      pushToast({
        title: 'Não foi possível exportar o PDF',
        description: sanitizeErrorMessage(error),
        variant: 'error',
      });
    } finally {
      setExporting(false);
    }
  }, [transfers]);

  const canTransfer = Boolean(
    overview?.financialAccount.canTransfer && overview?.features.manualWithdrawEnabled,
  );
  const canPixTransfer = Boolean(overview?.features.pixTransferEnabled);
  const canTedTransfer = Boolean(overview?.features.bankTransferEnabled);
  const availableBalance = overview?.balance.available ?? 0;

  function openTransferDialog(recipient?: TransferRecipient) {
    setPrefilledRecipient(recipient ?? null);
    setTransferDialogOpen(true);
  }

  function openTransferDetail(transfer: TransfersResponse['items'][number]) {
    router.push(`/financeiro/conta/transferencias/${transfer.id}`);
  }

  async function handleCancelTransfer() {
    if (!transferToCancel) return;

    setCanceling(true);
    try {
      await readJson(`/api/finance/transfers/${transferToCancel.id}/cancel`, {
        method: 'POST',
      });

      pushToast({
        title: 'Transferência cancelada',
        description: 'A solicitação foi cancelada e a tabela foi atualizada com o estado oficial retornado.',
        variant: 'success',
      });

      setTransferToCancel(null);
      await refreshCurrentView();
    } catch (error) {
      pushToast({
        title: 'Não foi possível cancelar a transferência',
        description: mapCancelTransferErrorMessage(sanitizeErrorMessage(error)),
        variant: 'error',
      });
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return <ContaSkeleton />;
  }

  if (error || !overview || !transfers) {
    return (
      <div className="space-y-5 pr-4 xl:pr-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-6 py-5">
          <p className="text-sm font-semibold text-rose-900">Não foi possível carregar a conta</p>
          <p className="mt-1 text-sm text-rose-700">
            Recarregue os dados para consultar saldo, transferências e disponibilidade operacional.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void loadInitialData(page)}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pr-4 xl:pr-6">
      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Saldo</h1>
        <p className="text-sm text-slate-500">Acompanhe o saldo disponível, as receitas do extrato e as transferências da conta.</p>
      </section>
      <section className="rounded-xl bg-[#EEE7FB] px-8 py-10 shadow-sm">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-[#6B6480]">Saldo disponível</p>
              <p className="mt-2 text-3xl font-semibold leading-none tracking-tight text-[#15121D] sm:text-[2.5rem] lg:text-[2.75rem]">
                {formatCurrency(availableBalance)}
              </p>
            </div>

            <p className="text-sm text-[#6B6480]">Este saldo já está disponível para transferência.</p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <p className="max-w-sm text-sm leading-6 text-[#6B6480] lg:text-right">
              Transfira valores para contas cadastradas
              <br />
              e acompanhe cada saída da conta pelo extrato.
            </p>

            <div className="flex max-lg:flex-col flex-wrap items-stretch gap-3 lg:justify-end">
            <Button
              onClick={() => openTransferDialog()}
              disabled={!canTransfer}
              className="h-10 w-full rounded-xl bg-brand-accent px-8 text-sm font-medium text-white shadow-none hover:bg-brand-accent/90 disabled:bg-brand-accent/40 lg:w-auto"
            >
              <ArrowUpRight className="mr-2 h-4 w-4" />
              Transferir
            </Button>
            <Link
              href="/financeiro/extrato"
              className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-brand-accent px-8 text-sm font-medium text-white shadow-none transition hover:bg-brand-accent/90 lg:w-auto"
            >
              <ReceiptText className="mr-2 h-4 w-4" />
              Ver extrato
            </Link>
            </div>
          </div>
        </div>
      </section>

      <TransferTableSection
        data={transfers}
        loading={tableLoading}
        onPageChange={(nextPage) => void loadInitialData(nextPage)}
        onRequestCancel={setTransferToCancel}
        onViewTransfer={openTransferDetail}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearFilters={handleClearFilters}
        onExport={() => void handleExportTransfers()}
        exporting={exporting}
      />

      <TransferWizardDialog
        open={transferDialogOpen}
        onOpenChange={(open) => {
          setTransferDialogOpen(open);
          if (!open) {
            setPrefilledRecipient(null);
          }
        }}
        recipients={recipients}
        initialRecipient={prefilledRecipient}
        canPix={canPixTransfer}
        canTed={canTedTransfer}
        maxAmount={availableBalance}
        onSuccess={refreshCurrentView}
        onRecipientsChange={loadOverviewAndRecipients}
      />

      <ConfirmDialog
        open={transferToCancel !== null}
        onOpenChange={(open) => {
          if (!open) setTransferToCancel(null);
        }}
        title="Cancelar transferência?"
        description="Fluxo afetado: matrícula - plano - cobrança - pagamento. O cancelamento só é permitido enquanto a transferência ainda não chegou a estado terminal, preservando auditoria e reprocessamento seguro."
        confirmText="Cancelar transferência"
        cancelText="Voltar"
        variant="destructive"
        loading={canceling}
        onConfirm={() => {
          void handleCancelTransfer();
        }}
      />

      <div className="flex justify-center pt-1 pb-2">
        <AsaasSeal variant="negativo-preto" />
      </div>
    </div>
  );
}
