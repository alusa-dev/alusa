'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { pushToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { ChevronRight, DollarSign, Filter, Search } from '@/components/icons/icons';
import { Eye } from 'lucide-react';
import type { AnticipationItem, AnticipationStatus, ListAnticipationsResponse } from './types';
import { useFinanceLiveRefresh } from '../hooks/useFinanceLiveRefresh';
import {
  formatAnticipationStatus,
  formatBillingType,
  formatCurrency,
  formatDate,
  sourceLabel,
} from './utils';

const ALL_STATUS = '__ALL_STATUS__';
const PAGE_SIZE = 20;

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="flex min-h-[132px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e9dffc] text-[#2b2634]">
          <DollarSign className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[13px] font-semibold tracking-wide text-[#2b2634]">{label}</p>
          <p className="text-[11px] text-[#2b2634]/65">{detail}</p>
        </div>
      </div>
      <span className="block text-2xl font-semibold tracking-tight text-[#2b2634]">
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function getAnticipationBadgeVariant(status: AnticipationStatus): BadgeVariant {
  switch (status) {
    case 'CREDITED':
      return 'success';
    case 'PENDING':
    case 'SCHEDULED':
      return 'warning';
    case 'DENIED':
    case 'OVERDUE':
      return 'destructive';
    case 'CANCELLED':
    case 'DEBITED':
    default:
      return 'neutral';
  }
}

function StatusBadge({ status, className }: { status: AnticipationStatus; className?: string }) {
  return (
    <Badge variant={getAnticipationBadgeVariant(status)} className={cn(className)}>
      {formatAnticipationStatus(status)}
    </Badge>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f4ecfd] text-[#2b2634]">
        <DollarSign className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-slate-900">Nenhuma antecipação encontrada</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
        As solicitações feitas pelo Asaas aparecem aqui com status, taxa, valor líquido e data prevista.
      </p>
      <Button asChild className="mt-5 rounded-xl bg-brand-accent px-5 text-white hover:bg-brand-accent/90">
        <Link href="/antecipacoes/antecipar">Antecipar recebimento</Link>
      </Button>
    </div>
  );
}

function AnticipationsTable({
  items,
  loading,
  onCancel,
  cancelingId,
  onPreview,
}: {
  items: AnticipationItem[];
  loading: boolean;
  onCancel: (_item: AnticipationItem) => void;
  cancelingId: string | null;
  onPreview: (_item: AnticipationItem) => void;
}) {
  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <tbody>
            <tr>
              <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">
                <div className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                  Carregando...
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <tbody>
            <tr>
              <td colSpan={7} className="p-0">
                <EmptyState />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="hidden bg-gray-50 lg:table-header-group">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 lg:px-5">
              Recebível
            </th>
            <th className="w-[1%] whitespace-nowrap px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 lg:px-5">
              Status
            </th>
            <th className="hidden px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">
              Valor
            </th>
            <th className="hidden px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">
              Taxa
            </th>
            <th className="hidden px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">
              Líquido
            </th>
            <th className="hidden px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 lg:table-cell">
              Previsão
            </th>
            <th className="w-[1%] whitespace-nowrap px-2 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 lg:px-5">
              Ações
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((item) => {
            const canCancel = item.status === 'PENDING' || item.status === 'SCHEDULED';
            const title = item.context.description ?? item.payment ?? item.installment ?? item.id;
            const subtitle = `${item.context.payerName ?? sourceLabel(item.context.source)} • ${item.payment ?? item.installment ?? '—'}`;
            const billing = item.context.billingType ? formatBillingType(item.context.billingType) : null;
            return (
              <tr key={item.id} className="transition-colors hover:bg-slate-50/80">
                <td className="min-w-0 px-3 py-3 lg:px-5 lg:py-4">
                  <div className="flex items-stretch gap-3 lg:hidden">
                    <ul className="m-0 min-w-0 flex-1 list-none space-y-1 p-0" role="list">
                      <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-semibold leading-snug text-slate-900">{title}</span>
                        <span className="text-xs font-semibold tabular-nums text-slate-900">
                          {formatCurrency(item.value)}
                        </span>
                      </li>
                      <li className="truncate text-xs text-slate-500">{subtitle}</li>
                      {billing ? (
                        <li className="text-[12px] font-medium text-slate-800">{billing}</li>
                      ) : null}
                      <li className="text-[12px] font-semibold text-emerald-700">
                        Líquido {formatCurrency(item.netValue)}
                      </li>
                      <li className="text-[12px] tabular-nums text-slate-600">Taxa {formatCurrency(item.fee)}</li>
                      <li className="text-[12px] tabular-nums text-slate-600">
                        {formatDate(item.anticipationDate ?? item.dueDate)}
                      </li>
                      {canCancel ? (
                        <li className="pt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg text-xs"
                            disabled={cancelingId === item.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              onCancel(item);
                            }}
                          >
                            {cancelingId === item.id ? 'Cancelando...' : 'Cancelar'}
                          </Button>
                        </li>
                      ) : null}
                    </ul>
                    <div className="flex shrink-0 flex-col items-end justify-between self-stretch">
                      <button
                        type="button"
                        className="-mr-1 -mt-0.5 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#753CB8] focus-visible:ring-offset-1"
                        aria-label="Ver detalhes da antecipação"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPreview(item);
                        }}
                      >
                        <Eye className="h-4 w-4 shrink-0" aria-hidden />
                      </button>
                      <StatusBadge
                        status={item.status}
                        className="max-w-[10.5rem] whitespace-normal text-right text-xs leading-tight"
                      />
                    </div>
                  </div>

                  <div className="hidden lg:block">
                    <p className="truncate text-sm font-medium text-slate-900">{title}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
                  </div>
                </td>
                <td className="hidden px-2 py-4 lg:table-cell lg:px-5">
                  <StatusBadge status={item.status} />
                </td>
                <td className="hidden px-5 py-4 text-right text-sm text-slate-700 lg:table-cell">
                  {formatCurrency(item.value)}
                </td>
                <td className="hidden px-5 py-4 text-right text-sm text-slate-700 lg:table-cell">
                  {formatCurrency(item.fee)}
                </td>
                <td className="hidden px-5 py-4 text-right text-sm font-semibold text-emerald-700 lg:table-cell">
                  {formatCurrency(item.netValue)}
                </td>
                <td className="hidden px-5 py-4 text-sm text-slate-600 lg:table-cell">
                  {formatDate(item.anticipationDate ?? item.dueDate)}
                </td>
                <td className="hidden px-2 py-4 text-right lg:table-cell lg:px-5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={!canCancel || cancelingId === item.id}
                    onClick={() => onCancel(item)}
                  >
                    {cancelingId === item.id ? 'Cancelando...' : 'Cancelar'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MinhasAntecipacoesPage() {
  const [data, setData] = useState<ListAnticipationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [status, setStatus] = useState<string>(ALL_STATUS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<AnticipationItem | null>(null);
  const inFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const load = useCallback(async (silent = false) => {
    const requestKey = `${page}:${status}`;
    const inFlight = inFlightRef.current;
    if (inFlight?.key === requestKey) {
      return inFlight.promise;
    }

    const trackedPromise = (async () => {
      if (!silent) setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (status !== ALL_STATUS) params.set('status', status);
        const response = await fetch(`/api/financeiro/antecipacoes?${params.toString()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Falha ao carregar antecipações');
        setData(await response.json());
        setLastSyncedAt(new Date());
      } catch (error) {
        if (!silent) {
          pushToast({
            title: 'Não foi possível carregar antecipações',
            description: error instanceof Error ? error.message : 'Tente novamente.',
            variant: 'error',
          });
        }
      }
    })();

    inFlightRef.current = { key: requestKey, promise: trackedPromise };
    trackedPromise.finally(() => {
      if (inFlightRef.current?.promise === trackedPromise) {
        inFlightRef.current = null;
      }
      if (!silent) setLoading(false);
    });
    return trackedPromise;
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useFinanceLiveRefresh(
    () => load(true),
    { intervalMs: 30_000, minIntervalMs: 8_000 },
  );

  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return data?.items ?? [];
    return (data?.items ?? []).filter((item) =>
      [
        item.id,
        item.payment,
        item.installment,
        item.context.description,
        item.context.payerName,
        item.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(term),
    );
  }, [data, search]);

  async function handleCancel(item: AnticipationItem) {
    setCancelingId(item.id);
    try {
      const response = await fetch(`/api/financeiro/antecipacoes/${item.id}/cancelar`, { method: 'POST' });
      if (!response.ok) throw new Error('Cancelamento rejeitado pelo Asaas');
      pushToast({ title: 'Antecipação cancelada', variant: 'success' });
      await load();
    } catch (error) {
      pushToast({
        title: 'Não foi possível cancelar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'error',
      });
    } finally {
      setCancelingId(null);
    }
  }

  const lastSyncLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="w-full min-w-0 space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Antecipações</p>
            <h1 className="mt-1 text-[22px] font-semibold text-gray-900 md:text-[24px]">Minhas antecipações</h1>
            <p className="mt-1 text-[13px] leading-5 text-slate-600">
              Acompanhe solicitações de recebíveis, taxas, valor líquido e retorno da análise feita pelo Asaas.
            </p>
          </div>
          <Button asChild className="h-10 w-full rounded-xl bg-brand-accent px-5 text-white hover:bg-brand-accent/90 lg:w-auto">
            <Link href="/antecipacoes/antecipar">
              Antecipar recebimento
              <ChevronRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Solicitado" detail="página atual" value={data?.summary.requestedValue ?? 0} />
        <SummaryCard label="Líquido previsto" detail="após taxa Asaas" value={data?.summary.netValue ?? 0} />
        <SummaryCard label="Taxas" detail="custo das antecipações" value={data?.summary.fees ?? 0} />
        <SummaryCard label="Creditado" detail="já liberado na conta" value={data?.summary.credited ?? 0} />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-gray-50 px-4 py-4 md:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Lista de antecipações</p>
              <p className="mt-1 text-xs text-slate-500">
                {data?.total ?? 0} registro(s) no Asaas
                {lastSyncLabel ? ` • atualizado às ${lastSyncLabel}` : ''}
              </p>
            </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por aluno, cobrança ou ID..."
                  className="h-10 rounded-lg border-slate-200 bg-white pl-9"
                />
              </div>
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-10 w-full min-w-0 rounded-lg border-slate-200 bg-white lg:w-[180px]">
                  <Filter className="mr-2 h-4 w-4 shrink-0" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUS}>Todos</SelectItem>
                  <SelectItem value="PENDING">Em análise</SelectItem>
                  <SelectItem value="SCHEDULED">Agendada</SelectItem>
                  <SelectItem value="CREDITED">Creditada</SelectItem>
                  <SelectItem value="DENIED">Negada</SelectItem>
                  <SelectItem value="CANCELLED">Cancelada</SelectItem>
                  <SelectItem value="OVERDUE">Vencida</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="h-10 w-full rounded-lg lg:w-auto"
                disabled={loading}
                onClick={() => void load()}
              >
                Atualizar
              </Button>
            </div>
          </div>
        </div>

        <AnticipationsTable
          items={visibleItems}
          loading={loading}
          onCancel={handleCancel}
          cancelingId={cancelingId}
          onPreview={setPreviewItem}
        />

        <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-5">
          <span>Página {page}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" className="rounded-lg" disabled={!data?.hasMore || loading} onClick={() => setPage((value) => value + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={previewItem !== null} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalhes da antecipação</DialogTitle>
            <DialogDescription>Resumo da solicitação conforme o Asaas.</DialogDescription>
          </DialogHeader>
          {previewItem ? (
            <div className="grid gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-500">Recebível</p>
                <p className="font-medium text-slate-900">
                  {previewItem.context.description
                    ?? previewItem.payment
                    ?? previewItem.installment
                    ?? previewItem.id}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Pagador / origem</p>
                <p className="text-slate-800">
                  {previewItem.context.payerName ?? '—'} · {sourceLabel(previewItem.context.source)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">Valor</p>
                  <p className="font-semibold tabular-nums text-slate-900">{formatCurrency(previewItem.value)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Taxa</p>
                  <p className="tabular-nums text-slate-800">{formatCurrency(previewItem.fee)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Líquido</p>
                <p className="font-semibold tabular-nums text-emerald-700">
                  {formatCurrency(previewItem.netValue)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Previsão</p>
                <p className="tabular-nums text-slate-800">
                  {formatDate(previewItem.anticipationDate ?? previewItem.dueDate)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Status</p>
                <StatusBadge status={previewItem.status} />
              </div>
              {previewItem.denialObservation ? (
                <div>
                  <p className="text-xs font-medium text-slate-500">Observação</p>
                  <p className="text-slate-800">{previewItem.denialObservation}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
