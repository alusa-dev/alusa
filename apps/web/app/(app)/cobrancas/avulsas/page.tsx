'use client';

/**
 * Página: Cobranças → Avulsas
 *
 * Exibe apenas cobranças avulsas (tipo AVULSA ou standalone).
 * UI alinhada à listagem "Todas as cobranças" (TableLayout, EntityFiltersBar, tabela responsiva).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, ChevronLeft, ChevronRight } from '@/components/icons/icons';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, { type SortOrder } from '@/components/layout/EntityFiltersBar';
import { Badge, type BadgeVariant, type StatusType } from '@/components/ui/badge';
import { pushToast } from '@/components/ui/toast';
import { CobrancaActionsMenu } from '@/components/financeiro/CobrancaActionsMenu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateChargeModal } from '@/components/financeiro/CreateChargeModal';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => new Date(dateStr || '').toLocaleDateString('pt-BR');

const getTipoLabel = (tipo: string | undefined, origin: string | undefined) => {
  if (origin === 'STANDALONE') return 'Avulsa Externa';
  const labels: Record<string, string> = {
    AVULSA: 'Avulsa',
    TAXA_MATRICULA: 'Taxa de Matrícula',
    EXTRA: 'Extra',
    MATERIAL: 'Material',
    UNIFORME: 'Uniforme',
  };
  return labels[tipo ?? ''] || tipo || 'Avulsa';
};

function getChargeBadgePresentation(mapped: StatusType): { variant: BadgeVariant; label: string } {
  if (['CONFIRMED', 'RECEIVED', 'PAGO', 'MANUAL', 'RECEIVED_IN_CASH', 'CONCLUIDO'].includes(mapped)) {
    return { variant: 'success', label: 'Pago' };
  }
  if (mapped === 'FAILED') {
    return { variant: 'destructive', label: 'Falha' };
  }
  if (['OVERDUE', 'ATRASADO'].includes(mapped)) {
    return { variant: 'destructive', label: 'Atrasado' };
  }
  if (['CANCELED', 'CANCELADO', 'EXPIRADO', 'CANCELADA'].includes(mapped)) {
    return { variant: 'neutral', label: 'Cancelado' };
  }
  if (['REFUNDED', 'ESTORNADO', 'REFUND_REQUESTED', 'ESTORNADO_PARCIAL'].includes(mapped)) {
    return { variant: 'neutral', label: 'Estorno' };
  }
  if (mapped === 'PROCESSANDO') {
    return { variant: 'info', label: 'Processando' };
  }
  return { variant: 'warning', label: 'Pendente' };
}

type Cobranca = {
  id: string;
  description?: string | null;
  tipo?: string;
  status?: string;
  liquidacaoStatus?: string;
  valor: number;
  vencimento?: string;
  aluno?: { id?: string; nome?: string };
  matricula?: { aluno?: { nome?: string } };
  atrasado?: boolean;
  asaasPaymentId?: string | null;
  matriculaId?: string | null;
  formaPagamento?: string | null;
  origin?: 'ACADEMIC' | 'STANDALONE';
};

export default function CobrancasAvulsasPage() {
  const router = useRouter();
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(6);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchParams = useSearchParams();
  const statusView = searchParams.get('view') || 'open';
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');

  const actionLoading = false;
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
    action?: () => Promise<void> | void;
  }>({ open: false, title: '', description: '', variant: 'default', action: async () => {} });

  const { isInitialLoading, refresh } = useFinanceListLoad(
    async ({ signal }) => {
      const params = new URLSearchParams();
      params.set('statusView', statusView);
      params.set('scope', 'standalone');
      const res = await fetch(`/api/financeiro/cobrancas?${params.toString()}`, {
        cache: 'no-store',
        signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg =
          typeof data?.error === 'string'
            ? data.error
            : data?.error?.message || 'Falha ao carregar cobranças';
        pushToast({
          title: 'Erro',
          description: errorMsg,
          variant: 'error',
        });
        setCobrancas([]);
        return;
      }
      const payload = await res.json().catch(() => null);
      setCobrancas((payload && payload.data) || payload || []);
    },
    { deps: [statusView] },
  );

  const handleStatusViewChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', value);
      router.replace(`/cobrancas/avulsas?${params.toString()}`);
      setPage(1);
    },
    [searchParams, router],
  );

  const orderedCobrancas = useMemo(() => {
    let items = [...cobrancas];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((c) => {
        const name = (c.aluno?.nome ?? c.matricula?.aluno?.nome ?? '').toLowerCase();
        const description = (c.description ?? '').toLowerCase();
        return name.includes(q) || description.includes(q) || c.id.toLowerCase().includes(q);
      });
    }
    items.sort((a, b) => {
      const ta = new Date(a.vencimento ?? '').getTime() || 0;
      const tb = new Date(b.vencimento ?? '').getTime() || 0;
      return ta - tb;
    });
    if (sortOrder === 'DESC') items.reverse();
    return items;
  }, [cobrancas, searchQuery, sortOrder]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, sortOrder, statusView]);

  const statusMap: Record<string, StatusType> = {
    PENDENTE: 'PENDENTE',
    A_VENCER: 'A_VENCER',
    PROCESSANDO: 'PROCESSANDO',
    PAGO: 'PAGO',
    ATRASADO: 'ATRASADO',
    CANCELADO: 'CANCELADO',
    CANCELAMENTO_PENDENTE: 'CANCELAMENTO_PENDENTE',
    ESTORNADO: 'ESTORNADO',
    ESTORNADO_PARCIAL: 'ESTORNADO_PARCIAL',
  };

  const handlePrint = (cobranca: Cobranca) => {
    if (!cobranca?.id) return;
    window.open(`/cobrancas/${cobranca.id}`);
  };

  const handleCreateCharge = useCallback(() => {
    setCreateModalOpen(true);
  }, []);

  const payerName = (c: Cobranca) => c.aluno?.nome ?? c.matricula?.aluno?.nome ?? 'Cliente não identificado';

  return (
    <TableLayout
      className="min-w-0 max-w-full pb-6"
      title="Cobranças Avulsas"
      subtitle="Cobranças independentes, não vinculadas a parcelamentos ou assinaturas."
      headerEnd={<AsaasSeal variant="negativo-preto" />}
      actions={
        <Button
          onClick={handleCreateCharge}
          className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
          aria-label="Gerar nova cobrança avulsa"
          disabled={actionLoading}
        >
          <Plus className="mr-2 h-4 w-4 transition-none" />
          Nova cobrança avulsa
        </Button>
      }
      filtersBar={
        <EntityFiltersBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Buscar por aluno ou descrição..."
          statusValue="TODOS"
          onStatusChange={() => {}}
          hideStatusFilter
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          sortMenuTitle="Ordenar por vencimento"
          sortAscLabel="Mais antigo primeiro"
          sortDescLabel="Mais recente primeiro"
          extraLeft={
            <div className="grid min-w-0 w-full grid-cols-1 gap-2 lg:flex lg:w-auto lg:shrink-0 lg:gap-2">
              <Select value={statusView} onValueChange={handleStatusViewChange}>
                <SelectTrigger className="flex h-10 w-full min-w-0 shrink-0 items-center justify-between gap-2 rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:w-auto lg:min-w-[150px] lg:max-w-[190px]">
                  <SelectValue placeholder="Em aberto" />
                </SelectTrigger>
                <SelectContent align="end" className="text-[13px]">
                  <SelectItem value="open">Em aberto</SelectItem>
                  <SelectItem value="paid">Pagas</SelectItem>
                  <SelectItem value="all">Todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
      }
      footer={
        <footer className="mt-8 flex min-w-0 max-w-full flex-col items-center border-t border-gray-100 pt-8 lg:hidden">
          <AsaasSeal variant="negativo-preto" />
        </footer>
      }
    >
      <div className="min-w-0 w-full max-w-full overflow-x-hidden rounded-lg border border-gray-200 bg-white md:rounded-xl">
        {isInitialLoading ? (
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
                  <Skeleton className="col-span-2 h-4 w-20" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-6 w-16 rounded-full" />
                  <Skeleton className="col-span-1 h-8 w-8 justify-self-center" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="hidden border-b bg-gray-50 px-6 py-3 lg:block">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                <div className="col-span-3">Cliente</div>
                <div className="col-span-2 text-center">Valor</div>
                <div className="col-span-2 text-center">Tipo</div>
                <div className="col-span-2 text-center">Vencimento</div>
                <div className="col-span-2 text-center">Status</div>
                <div className="col-span-1 text-center">Ações</div>
              </div>
            </div>

            <div className="min-w-0 divide-y">
              {orderedCobrancas.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhuma cobrança avulsa encontrada
                </div>
              ) : (
                orderedCobrancas.slice((page - 1) * pageSize, page * pageSize).map((cobranca) => {
                  const isOverdue = Boolean(cobranca.atrasado) || cobranca.status === 'ATRASADO';
                  const baseStatus = cobranca.status ?? 'PENDENTE';
                  const mapped =
                    baseStatus === 'PAGO' && cobranca.liquidacaoStatus === 'DISPONIVEL'
                      ? 'RECEIVED'
                      : statusMap[baseStatus] ?? 'PENDING';
                  const badge = getChargeBadgePresentation(mapped as StatusType);

                  const handleRowClick = () => router.push(`/cobrancas/${cobranca.id}`);

                  return (
                    <div key={cobranca.id}>
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
                            <div className="truncate text-[13px] font-medium text-gray-900">{payerName(cobranca)}</div>
                            {cobranca.description ? (
                              <div className="mt-0.5 line-clamp-2 break-words text-[11px] text-gray-500">
                                {cobranca.description}
                              </div>
                            ) : null}
                            <div className="mt-2 space-y-1 text-[12px] text-gray-600">
                              <div className="break-words font-semibold text-gray-900">
                                {formatCurrency(cobranca.valor)}
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                                <span className="min-w-0 break-words text-gray-600">
                                  {getTipoLabel(cobranca.tipo, cobranca.origin)}
                                </span>
                                <span className="shrink-0 text-gray-300" aria-hidden>
                                  ·
                                </span>
                                <span
                                  className={`shrink-0 tabular-nums ${
                                    isOverdue ? 'font-medium text-red-600' : 'text-gray-700'
                                  }`}
                                >
                                  {formatDate(cobranca.vencimento ?? '')}
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
                              <CobrancaActionsMenu
                                cobranca={{
                                  id: cobranca.id,
                                  status: (cobranca.status ?? '') as string,
                                  asaasPaymentId: cobranca.asaasPaymentId ?? undefined,
                                  matriculaId: cobranca.matriculaId ?? '',
                                  formaPagamento: cobranca.formaPagamento ?? undefined,
                                  atrasado: Boolean(cobranca.atrasado),
                                }}
                                onPrint={() => handlePrint(cobranca)}
                                onActionComplete={() => refresh()}
                                variant="icon"
                              />
                            </div>
                            <div className="mt-auto shrink-0 pt-1">
                              <Badge
                                variant={badge.variant}
                                size="sm"
                                className="w-full max-w-full whitespace-normal px-2 text-center text-[10px] leading-snug"
                              >
                                {badge.label}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <div className="hidden min-w-0 px-6 py-3 lg:block">
                          <div className="grid min-w-0 grid-cols-12 items-center gap-4">
                            <div className="col-span-3 min-w-0">
                              <div className="truncate text-[13px] font-medium text-gray-900">{payerName(cobranca)}</div>
                            </div>
                            <div className="col-span-2 text-center text-[13px] font-semibold text-gray-900">
                              {formatCurrency(cobranca.valor)}
                            </div>
                            <div className="col-span-2 text-center text-[13px] text-gray-700">
                              {getTipoLabel(cobranca.tipo, cobranca.origin)}
                            </div>
                            <div className="col-span-2 text-center">
                              <div
                                className={`text-[13px] ${isOverdue ? 'font-medium text-red-600' : 'text-gray-700'}`}
                              >
                                {formatDate(cobranca.vencimento ?? '')}
                              </div>
                            </div>
                            <div className="col-span-2 flex justify-center">
                              <Badge variant={badge.variant} size="sm">
                                {badge.label}
                              </Badge>
                            </div>
                            <div
                              className="col-span-1 flex justify-center"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <CobrancaActionsMenu
                                cobranca={{
                                  id: cobranca.id,
                                  status: (cobranca.status ?? '') as string,
                                  asaasPaymentId: cobranca.asaasPaymentId ?? undefined,
                                  matriculaId: cobranca.matriculaId ?? '',
                                  formaPagamento: cobranca.formaPagamento ?? undefined,
                                  atrasado: Boolean(cobranca.atrasado),
                                }}
                                onPrint={() => handlePrint(cobranca)}
                                onActionComplete={() => refresh()}
                                variant="icon"
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
            {orderedCobrancas.length > pageSize ? (
              <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
                <Pagination
                  totalItems={orderedCobrancas.length}
                  pageSize={pageSize}
                  page={page}
                  onChange={setPage}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.action as () => void}
        loading={actionLoading}
        confirmText={actionLoading ? 'Processando...' : 'Confirmar'}
      />

      <CreateChargeModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onSuccess={() => void refresh()}
        defaultChargeType="ONE_TIME"
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
    const maxButtons = 7;
    if (totalPages <= maxButtons + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    const siblings = 2;
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
    <div className="flex min-h-9 flex-col items-center justify-between gap-3 sm:flex-row">
      <div className="text-xs font-medium text-gray-500">
        Página {page} de {totalPages}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
      <PaginationTextButton aria-label="Página anterior" disabled={page === 1} onClick={() => onChange(clamp(page - 1))}>
        <ChevronLeft className="h-4 w-4" />
        <span>Anterior</span>
      </PaginationTextButton>

      {pages.map((p, idx) =>
        p === '…' ? (
          <span key={`e-${idx}`} className="grid h-9 min-w-9 place-items-center px-1 text-sm font-semibold text-gray-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={
              'grid h-8 min-w-8 place-items-center rounded-full border px-2 text-sm font-semibold transition ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30 ' +
              (p === page
                ? 'border-transparent bg-gray-200 text-gray-900 hover:bg-gray-200'
                : 'border-transparent bg-transparent text-gray-700 hover:bg-white hover:text-brand-accent')
            }
          >
            {p}
          </button>
        ),
      )}

      <PaginationTextButton
        aria-label="Próxima página"
        disabled={page === totalPages}
        onClick={() => onChange(clamp(page + 1))}
      >
        <span>Próxima</span>
        <ChevronRight className="h-4 w-4" />
      </PaginationTextButton>
      </div>
    </div>
  );
}

function PaginationTextButton({
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
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-semibold text-gray-700 transition hover:bg-white hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300"
    >
      {children}
    </button>
  );
}
