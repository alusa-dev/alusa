'use client';

/**
 * Página: Cobranças → Assinaturas
 *
 * Lista de assinaturas com UI alinhada à página "Todas as cobranças".
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, { type SortOrder } from '@/components/layout/EntityFiltersBar';
import { pushToast } from '@/components/ui/toast';
import { CreateChargeModal } from '@/components/financeiro/CreateChargeModal';
import { SubscriptionActionsMenu } from '@/components/financeiro/SubscriptionActionsMenu';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import type { FinanceSubscriptionEnrichedItemDTO } from '@/features/finance/dtos';
import { formatFormaPagamentoLabel } from '@/lib/finance/asaas-sync';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

type Assinatura = FinanceSubscriptionEnrichedItemDTO;

const TIPO_LABELS: Record<string, string> = {
  PLANO: 'Plano',
  COMBO: 'Combo',
  AVULSA: 'Avulsa',
};

function subscriptionStatusChipClass(status: string): string {
  const u = (status ?? '').toUpperCase();
  if (u === 'ACTIVE') return 'bg-emerald-100 text-emerald-800';
  if (u === 'INACTIVE') return 'bg-slate-100 text-slate-700';
  if (u === 'EXPIRED') return 'bg-amber-100 text-amber-800';
  if (u === 'DELETED') return 'bg-gray-100 text-gray-500';
  return 'bg-slate-100 text-slate-700';
}

function formatAssinaturaDescription(assinatura: Assinatura): string {
  const description = assinatura.description?.trim();

  if (assinatura.matriculaId) {
    return description ? `Matrícula • ${description}` : 'Matrícula';
  }

  return description || '—';
}

export default function AssinaturasPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState<boolean>(true);
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const statusFilter = searchParams.get('status') || '';
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (searchQuery) params.set('search', searchQuery);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/finance/subscriptions/enriched?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg =
          typeof data?.error === 'string'
            ? data.error
            : data?.error?.message || 'Falha ao carregar assinaturas';
        pushToast({
          title: 'Erro',
          description: errorMsg,
          variant: 'error',
        });
        setAssinaturas([]);
        return;
      }
      const payload = await res.json();
      setAssinaturas(payload.data || []);
      setTotal(payload.total || 0);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setAssinaturas([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchQuery, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusFilterChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'all') {
        params.set('status', value);
      } else {
        params.delete('status');
      }
      router.replace(`/cobrancas/assinaturas?${params.toString()}`);
      setPage(1);
    },
    [searchParams, router],
  );

  const orderedAssinaturas = useMemo(() => {
    const items = [...assinaturas];
    items.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return sortOrder === 'DESC' ? tb - ta : ta - tb;
    });
    return items;
  }, [assinaturas, sortOrder]);

  return (
    <TableLayout
      className="min-w-0 max-w-full pb-6"
      title="Assinaturas"
      subtitle="Cobranças recorrentes (acadêmicas e manuais) com sincronização financeira automática."
      headerEnd={<AsaasSeal variant="negativo-preto" />}
      actions={
        <Button
          className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
          onClick={() => setCreateModalOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4 transition-none" />
          Adicionar assinatura
        </Button>
      }
      filtersBar={
        <EntityFiltersBar
          searchValue={searchQuery}
          onSearchChange={(v) => {
            setSearchQuery(v);
            setPage(1);
          }}
          searchPlaceholder="Buscar por aluno ou descrição..."
          statusValue="TODOS"
          onStatusChange={() => {}}
          hideStatusFilter
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          sortMenuTitle="Ordenar por data"
          sortAscLabel="Mais antigo primeiro"
          sortDescLabel="Mais recente primeiro"
          extraLeft={
            <div className="grid min-w-0 w-full grid-cols-1 gap-2 lg:flex lg:w-auto lg:shrink-0 lg:gap-2">
              <Select value={statusFilter || 'all'} onValueChange={handleStatusFilterChange}>
                <SelectTrigger className="flex h-10 w-full min-w-0 shrink-0 items-center justify-between gap-2 rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:w-auto lg:min-w-[150px] lg:max-w-[190px]">
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent align="end" className="text-[13px]">
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ACTIVE">Ativas</SelectItem>
                  <SelectItem value="INACTIVE">Inativas</SelectItem>
                  <SelectItem value="EXPIRED">Expiradas</SelectItem>
                  <SelectItem value="DELETED">Excluídas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
      }
      footer={
        <>
          {total > 0 ? (
            <Pagination totalItems={total} pageSize={pageSize} page={page} onChange={setPage} />
          ) : null}
          <footer className="mt-8 flex min-w-0 max-w-full flex-col items-center border-t border-gray-100 pt-8 lg:hidden">
            <AsaasSeal variant="negativo-preto" />
          </footer>
        </>
      }
    >
      <div className="min-w-0 w-full max-w-full overflow-x-hidden rounded-lg border border-gray-200 bg-white md:rounded-xl">
        {loading ? (
          <>
            <div className="hidden border-b bg-gray-50 px-6 py-3 lg:block">
              <div className="grid grid-cols-12 gap-4">
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-1 h-4" />
              </div>
            </div>
            <div className="divide-y lg:hidden">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="min-w-0 space-y-2 px-4 py-3 sm:px-5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="hidden px-6 py-3 lg:block">
                <div className="grid grid-cols-12 items-center gap-4">
                  <Skeleton className="col-span-3 h-4 w-40" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-4 w-20" />
                  <Skeleton className="col-span-2 h-4 w-20" />
                  <Skeleton className="col-span-1 h-8 w-8 justify-self-center" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="hidden border-b bg-gray-50 px-6 py-3 lg:block">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                <div className="col-span-3">Aluno</div>
                <div className="col-span-2 text-center">Valor</div>
                <div className="col-span-2 text-center">Descrição</div>
                <div className="col-span-2 text-center">Tipo</div>
                <div className="col-span-2 text-center">Forma Pgto.</div>
                <div className="col-span-1 text-center">Ações</div>
              </div>
            </div>

            <div className="min-w-0 divide-y">
              {orderedAssinaturas.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhuma assinatura encontrada
                </div>
              ) : (
                orderedAssinaturas.map((assinatura) => {
                  const handleRowClick = () => router.push(`/cobrancas/assinaturas/${assinatura.id}`);
                  const statusCls = subscriptionStatusChipClass(assinatura.status);
                  return (
                    <div key={assinatura.id}>
                      <div
                        className="cursor-pointer bg-white transition-colors hover:bg-gray-50"
                        onClick={handleRowClick}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleRowClick();
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex min-w-0 w-full max-w-full gap-2 px-4 py-3 box-border sm:gap-3 sm:px-5 lg:hidden">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-[13px] font-medium text-gray-900">
                              {assinatura.alunoNome}
                            </div>
                            <div className="mt-2 space-y-1 text-[12px] text-gray-600">
                              <div>
                                <span className="font-semibold text-gray-900">
                                  {formatCurrency(assinatura.valor)}
                                </span>
                                <span className="ml-1 text-[11px] font-normal text-gray-500">
                                  {assinatura.cycleLabel}
                                </span>
                              </div>
                              {formatAssinaturaDescription(assinatura) !== '—' ? (
                                <div className="line-clamp-2 break-words text-[11px] text-gray-500">
                                  {formatAssinaturaDescription(assinatura)}
                                </div>
                              ) : null}
                              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-gray-600">
                                <span className="min-w-0 break-words">{TIPO_LABELS[assinatura.tipo ?? ''] ?? assinatura.tipo ?? 'Plano'}</span>
                                <span className="shrink-0 text-gray-300" aria-hidden>
                                  ·
                                </span>
                                <span className="min-w-0 break-words">
                                  {formatFormaPagamentoLabel(assinatura.billingType)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div
                            className="flex w-14 shrink-0 flex-col items-end self-stretch sm:w-[3.75rem]"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <div className="shrink-0">
                              <SubscriptionActionsMenu
                                subscriptionId={assinatura.id}
                                asaasSubscriptionId={assinatura.asaasSubscriptionId}
                                status={assinatura.status}
                                matriculaId={assinatura.matriculaId}
                                onActionComplete={() => load()}
                              />
                            </div>
                            <div className="mt-auto shrink-0 pt-1">
                              <span
                                className={`inline-flex max-w-full items-center justify-center rounded-full px-2 py-0.5 text-center text-[10px] font-medium leading-snug whitespace-normal ${statusCls}`}
                              >
                                {assinatura.statusLabel || assinatura.status}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="hidden min-w-0 px-6 py-3 lg:block">
                          <div className="grid min-w-0 grid-cols-12 items-center gap-4">
                            <div className="col-span-3 min-w-0">
                              <div className="truncate text-[13px] font-medium text-gray-900">
                                {assinatura.alunoNome}
                              </div>
                            </div>
                            <div className="col-span-2 text-center">
                              <div className="text-[13px] font-semibold text-gray-900">
                                {formatCurrency(assinatura.valor)}
                              </div>
                              <div className="text-[11px] text-gray-500">{assinatura.cycleLabel}</div>
                            </div>
                            <div className="col-span-2 min-w-0 text-center">
                              <div className="truncate text-[13px] text-gray-700">
                                {formatAssinaturaDescription(assinatura)}
                              </div>
                            </div>
                            <div className="col-span-2 text-center text-[13px] text-gray-700">
                              {TIPO_LABELS[assinatura.tipo ?? ''] ?? assinatura.tipo ?? 'Plano'}
                            </div>
                            <div className="col-span-2 text-center text-[13px] text-gray-700">
                              {formatFormaPagamentoLabel(assinatura.billingType)}
                            </div>
                            <div
                              className="col-span-1 flex justify-center"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <SubscriptionActionsMenu
                                subscriptionId={assinatura.id}
                                asaasSubscriptionId={assinatura.asaasSubscriptionId}
                                status={assinatura.status}
                                matriculaId={assinatura.matriculaId}
                                onActionComplete={() => load()}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      <CreateChargeModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onSuccess={() => {
          setPage(1);
          void load();
        }}
        defaultChargeType="SUBSCRIPTION"
      />
    </TableLayout>
  );
}

function Pagination({
  totalItems,
  pageSize,
  page,
  onChange,
}: {
  totalItems: number;
  pageSize: number;
  page: number;
  onChange: (_p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clamp = (n: number) => Math.min(totalPages, Math.max(1, n));

  const makePages = () => {
    const pages: (number | '…')[] = [];
    const maxButtons = 5;
    if (totalPages <= maxButtons + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    const siblings = 1;
    const left = Math.max(2, page - siblings);
    const right = Math.min(totalPages - 1, page + siblings);
    pages.push(1);
    if (left > 2) pages.push('…');
    for (let i = left; i <= right; i++) pages.push(i);
    if (right < totalPages - 1) pages.push('…');
    pages.push(totalPages);
    return pages;
  };

  const pages = makePages();

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-6 sm:gap-3">
      <IconButton aria-label="Primeira página" disabled={page === 1} onClick={() => onChange(1)}>
        <ChevronsLeft className="h-4 w-4" />
      </IconButton>
      <IconButton
        aria-label="Página anterior"
        disabled={page === 1}
        onClick={() => onChange(clamp(page - 1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </IconButton>

      {pages.map((p, idx) =>
        p === '…' ? (
          <span key={`e-${idx}`} className="px-2 text-brand-accent/50">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={
              'h-8 w-8 rounded-md border transition grid place-items-center ' +
              'border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 ' +
              (p === page
                ? 'bg-brand-accent text-white border-brand-accent hover:bg-brand-accent/90'
                : 'bg-white')
            }
          >
            {p}
          </button>
        ),
      )}

      <IconButton
        aria-label="Próxima página"
        disabled={page === totalPages}
        onClick={() => onChange(clamp(page + 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </IconButton>
      <IconButton
        aria-label="Última página"
        disabled={page === totalPages}
        onClick={() => onChange(totalPages)}
      >
        <ChevronsRight className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 rounded-md border grid place-items-center transition border-brand-accent/30 bg-white text-brand-accent hover:bg-brand-accent hover:text-white hover:border-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40 disabled:text-gray-300 disabled:border-gray-200 disabled:hover:bg-white disabled:hover:text-gray-300 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
