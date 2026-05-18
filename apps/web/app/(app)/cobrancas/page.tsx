'use client';

/**
 * Página: Cobranças → Todas
 *
 * Visão operacional "flattened" - exibe todas as cobranças independente do tipo.
 * Redireciona para a listagem existente em /financeiro/cobrancas, mantendo a
 * estrutura de navegação reorganizada.
 *
 * Domínio: Navegação
 * Esta página é apenas uma camada de navegação, sem lógica financeira.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
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
import { Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from '@/components/icons/icons';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, { type SortOrder } from '@/components/layout/EntityFiltersBar';
import { Badge, type BadgeVariant, type StatusType } from '@/components/ui/badge';
import { pushToast } from '@/components/ui/toast';
import { CobrancaActionsMenu } from '@/components/financeiro/CobrancaActionsMenu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateChargeModal } from '@/components/financeiro/CreateChargeModal';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => new Date(dateStr || '').toLocaleDateString('pt-BR');

const getTipoLabel = (tipo: string) => {
  const labels: Record<string, string> = {
    MENSALIDADE: 'Mensalidade',
    TAXA_MATRICULA: 'Taxa de Matrícula',
    EXTRA: 'Extra',
    AVULSA: 'Avulsa',
    PARCELADA: 'Parcelamento',
    RECORRENTE: 'Assinatura',
  };
  return labels[tipo] || tipo;
};

/** Rótulos curtos para listagens (evita badge largo tipo "Aguardando Pagamento"). */
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
  valor: number;
  vencimento?: string;
  payerName?: string;
  asaasPaymentId?: string | null;
  invoiceUrl?: string | null;
  matriculaId?: string | null;
  formaPagamento?: string | null;
  origin?: 'ACADEMIC' | 'STANDALONE';
  isGroup?: boolean;
  groupType?: 'INSTALLMENT' | null;
  groupId?: string | null;
  installmentCount?: number | null;
  installmentsPaid?: number | null;
};

export default function CobrancasTodasPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(true);
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(12);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tipoFilter, setTipoFilter] = useState<string>('TODOS');
  const searchParams = useSearchParams();
  const statusView = searchParams.get('view') || 'open';
  const shouldOpenCreateModal = searchParams.get('new') === '1';
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');

  const actionLoading = false;
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
    action?: () => Promise<void> | void;
  }>({ open: false, title: '', description: '', variant: 'default', action: async () => { } });

  useEffect(() => {
    if (shouldOpenCreateModal) {
      setCreateModalOpen(true);
    }
  }, [shouldOpenCreateModal]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // "open" → fila operacional (PENDING/OVERDUE, vencimento ≤ fim do mês)
      // "paid"/"all" → rota legada que aceita statusView
      const isOperational = statusView === 'open';
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      const trimmedSearch = searchQuery.trim();
      if (trimmedSearch) params.set('q', trimmedSearch);
      if (tipoFilter !== 'TODOS') params.append('tipo', tipoFilter);

      const url = isOperational
        ? `/api/finance/charges/operational?${params.toString()}`
        : `/api/financeiro/cobrancas?statusView=${statusView}&${params.toString()}`;

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
        setTotalItems(0);
        return;
      }
      const payload = await res.json().catch(() => null);
      const raw: unknown[] = (payload && payload.data) || payload || [];
      setTotalItems(typeof payload?.total === 'number' ? payload.total : raw.length);

      // Normaliza o shape conforme a origem
      const normalized: Cobranca[] = (raw as Record<string, unknown>[]).map((item) => {
        if (isOperational) {
          // UnifiedChargeItem → Cobranca
          return {
            id: item.id as string,
            description: (item.description as string | null | undefined) ?? null,
            tipo: item.tipo as string | undefined,
            status: item.status as string | undefined,
            valor: (item.value as number) ?? 0,
            vencimento: item.dueDate as string | undefined,
            payerName: item.payerName as string | undefined,
            asaasPaymentId: item.asaasPaymentId as string | null,
            invoiceUrl: item.invoiceUrl as string | null,
            matriculaId: item.matriculaId as string | null,
            formaPagamento: item.billingType as string | null,
            origin: item.origin as 'ACADEMIC' | 'STANDALONE',
            isGroup: item.isGroup as boolean | undefined,
            groupType: item.groupType as 'INSTALLMENT' | null,
            groupId: item.groupId as string | null,
            installmentCount: item.installmentCount as number | null,
            installmentsPaid: item.installmentsPaid as number | null,
          };
        }
        // Rota legada → manter shape antigo mas normalizar campos
        return {
          id: item.id as string,
          description: (item.description as string | null | undefined) ?? null,
          tipo: item.tipo as string | undefined,
          status: item.status as string | undefined,
          valor: (item.valor as number) ?? 0,
          vencimento: item.vencimento as string | undefined,
          payerName: ((item as Record<string, unknown>).aluno as Record<string, unknown>)?.nome as string
            ?? ((item as Record<string, unknown>).matricula as Record<string, unknown>)?.aluno
              ? (((item as Record<string, unknown>).matricula as Record<string, unknown>)?.aluno as Record<string, unknown>)?.nome as string
              : undefined,
          asaasPaymentId: item.asaasPaymentId as string | null,
          invoiceUrl: null,
          matriculaId: item.matriculaId as string | null,
          formaPagamento: item.formaPagamento as string | null,
          isGroup: item.isGroup as boolean | undefined,
          groupType: item.groupType as 'INSTALLMENT' | null,
          groupId: item.installmentPlanId as string | null,
          installmentCount: item.installmentCount as number | null,
          installmentsPaid: item.installmentsPaid as number | null,
        };
      });

      setCobrancas(normalized);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setCobrancas([]);
      setTotalItems(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, pageSize, searchQuery, statusView, tipoFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusView, tipoFilter]);

  useLiveRefresh(
    () => load(true),
    {
      enabled: !loading,
      intervalMs: 45_000,
      minIntervalMs: 10_000,
    },
  );

  const handleStatusViewChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', value);
      router.replace(`/cobrancas?${params.toString()}`);
      setPage(1);
    },
    [searchParams, router],
  );

  const orderedCobrancas = useMemo(() => {
    const items = [...cobrancas];
    items.sort((a, b) => {
      const ta = new Date(a.vencimento ?? '').getTime() || 0;
      const tb = new Date(b.vencimento ?? '').getTime() || 0;
      return ta - tb;
    });
    if (sortOrder === 'DESC') items.reverse();
    return items;
  }, [cobrancas, sortOrder]);

  const statusMap: Record<string, StatusType> = {
    // UnifiedChargeStatus (rota operacional)
    PENDING: 'PENDING',
    OVERDUE: 'OVERDUE',
    PAID: 'CONFIRMED',
    CANCELED: 'CANCELED',
    REFUNDED: 'REFUNDED',
    // StatusCobranca legado (rota fallback)
    PENDENTE: 'PENDING',
    PROCESSANDO: 'RECEIVED',
    PAGO: 'CONFIRMED',
    ATRASADO: 'OVERDUE',
    CANCELADO: 'CANCELED',
    ESTORNADO: 'REFUNDED',
    A_VENCER: 'PENDING',
    ESTORNADO_PARCIAL: 'REFUNDED',
  };

  const handlePrint = (cobranca: Cobranca) => {
    if (!cobranca?.id) return;
    window.open(`/cobrancas/${cobranca.id}`);
  };

  const handleCreateCharge = useCallback(() => {
    setCreateModalOpen(true);
  }, []);

  return (
    <TableLayout
      className="min-w-0 max-w-full pb-6"
      title="Todas as Cobranças"
      subtitle="Visão operacional de todas as cobranças da instituição."
      headerEnd={<AsaasSeal variant="negativo-preto" />}
      actions={
        <Button
          onClick={handleCreateCharge}
          className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 md:w-auto"
          aria-label="Gerar nova cobrança"
          disabled={actionLoading}
        >
          <Plus className="mr-2 h-4 w-4 transition-none" />
          Nova cobrança
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
            <div className="grid min-w-0 w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:shrink-0 lg:gap-2">
              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="flex h-10 w-full min-w-0 shrink-0 items-center justify-between gap-2 rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none lg:w-auto lg:min-w-[150px] lg:max-w-[190px]">
                  <SelectValue placeholder="Todos os tipos" />
                </SelectTrigger>
                <SelectContent align="end" className="text-[13px]">
                  <SelectItem value="TODOS">Todos os tipos</SelectItem>
                  <SelectItem value="MENSALIDADE">Mensalidade</SelectItem>
                  <SelectItem value="TAXA_MATRICULA">Taxa de Matrícula</SelectItem>
                  <SelectItem value="EXTRA">Extra</SelectItem>
                  <SelectItem value="AVULSA">Avulsa</SelectItem>
                  <SelectItem value="PARCELADA">Parcelamento</SelectItem>
                  <SelectItem value="RECORRENTE">Assinatura</SelectItem>
                </SelectContent>
              </Select>
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
        <>
          {orderedCobrancas.length > 0 ? (
            <Pagination
              totalItems={totalItems}
              pageSize={pageSize}
              page={page}
              onChange={setPage}
            />
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
                <Skeleton className="col-span-4 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-1 h-4" />
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
                  <Skeleton className="col-span-4 h-4 w-40" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-4 w-28" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-1 h-6 w-16 rounded-full" />
                  <Skeleton className="col-span-1 h-8 w-8 justify-self-center" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="hidden border-b bg-gray-50 px-6 py-3 lg:block">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                <div className="col-span-4">Nome</div>
                <div className="col-span-2 text-center">Valor</div>
                <div className="col-span-2 text-center">Tipo</div>
                <div className="col-span-2 text-center">Vencimento</div>
                <div className="col-span-1 text-center">Status</div>
                <div className="col-span-1 text-center">Ações</div>
              </div>
            </div>

            <div className="min-w-0 divide-y">
              {orderedCobrancas.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">Nenhuma cobrança encontrada</div>
              ) : (
                orderedCobrancas.map((cobranca) => {
                  const isOverdue = cobranca.status === 'OVERDUE' || cobranca.status === 'ATRASADO';
                  const isInstallmentGroup = cobranca.isGroup && cobranca.groupType === 'INSTALLMENT';
                  const mappedStatus = (statusMap[cobranca.status ?? 'PENDING'] ?? 'PENDING') as StatusType;
                  const badge = getChargeBadgePresentation(mappedStatus);

                  const handleRowClick = () => {
                    if (isInstallmentGroup && cobranca.groupId) {
                      router.push(`/cobrancas/parcelamentos/${cobranca.groupId}`);
                    } else {
                      router.push(`/cobrancas/${cobranca.id}`);
                    }
                  };

                  return (
                    <div key={cobranca.id}>
                      <div
                        className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                          isInstallmentGroup ? 'bg-gray-50/50' : 'bg-white'
                        }`}
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
                        {/* Mobile: uma coluna — valor, tipo e vencimento em linha auxiliar */}
                        <div className="flex min-w-0 w-full max-w-full gap-2 px-4 py-3 box-border sm:gap-3 sm:px-5 lg:hidden">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate text-[13px] font-medium text-gray-900">
                              {cobranca.payerName ?? '—'}
                            </div>
                            {cobranca.description ? (
                              <div className="mt-0.5 line-clamp-2 break-words text-[11px] text-gray-500">
                                {cobranca.description}
                              </div>
                            ) : null}
                            <div className="mt-2 space-y-1 text-[12px] text-gray-600">
                              <div className="break-words font-semibold text-gray-900">
                                {formatCurrency(cobranca.valor)}
                                {isInstallmentGroup && cobranca.installmentCount ? (
                                  <span className="ml-1 text-[11px] font-normal text-gray-500">
                                    ({cobranca.installmentsPaid ?? 0}/{cobranca.installmentCount})
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                                <span className="min-w-0 break-words text-gray-600">
                                  {getTipoLabel(cobranca.tipo ?? '')}
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
                              {!isInstallmentGroup ? (
                                <CobrancaActionsMenu
                                  cobranca={{
                                    id: cobranca.id,
                                    status: (cobranca.status ?? '') as string,
                                    asaasPaymentId: cobranca.asaasPaymentId ?? undefined,
                                    invoiceUrl: cobranca.invoiceUrl ?? undefined,
                                    matriculaId: cobranca.matriculaId ?? '',
                                    formaPagamento: cobranca.formaPagamento ?? undefined,
                                    atrasado: isOverdue,
                                  }}
                                  onPrint={() => handlePrint(cobranca)}
                                  onActionComplete={() => load()}
                                  variant="icon"
                                />
                              ) : null}
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

                        {/* Desktop: grade completa */}
                        <div className="hidden min-w-0 px-6 py-3 lg:block">
                          <div className="grid min-w-0 grid-cols-12 items-center gap-4">
                            <div className="col-span-4 flex min-w-0 items-center gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium text-gray-900">
                                  {cobranca.payerName ?? '-'}
                                </div>
                                {cobranca.description ? (
                                  <div className="truncate text-[11px] text-gray-500">
                                    {cobranca.description}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="col-span-2 text-center text-[13px] font-semibold text-gray-900">
                              {formatCurrency(cobranca.valor)}
                              {isInstallmentGroup && cobranca.installmentCount && (
                                <span className="ml-1 text-[11px] font-normal text-gray-500">
                                  ({cobranca.installmentsPaid ?? 0}/{cobranca.installmentCount})
                                </span>
                              )}
                            </div>
                            <div className="col-span-2 text-center text-[13px] text-gray-700">
                              {getTipoLabel(cobranca.tipo ?? '')}
                            </div>
                            <div className="col-span-2 text-center">
                              <div
                                className={`text-[13px] ${isOverdue ? 'font-medium text-red-600' : 'text-gray-700'}`}
                              >
                                {formatDate(cobranca.vencimento ?? '')}
                              </div>
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <Badge variant={badge.variant} size="sm">
                                {badge.label}
                              </Badge>
                            </div>
                            <div
                              className="col-span-1 flex justify-center"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              {!isInstallmentGroup && (
                                <CobrancaActionsMenu
                                  cobranca={{
                                    id: cobranca.id,
                                    status: (cobranca.status ?? '') as string,
                                    asaasPaymentId: cobranca.asaasPaymentId ?? undefined,
                                    invoiceUrl: cobranca.invoiceUrl ?? undefined,
                                    matriculaId: cobranca.matriculaId ?? '',
                                    formaPagamento: cobranca.formaPagamento ?? undefined,
                                    atrasado: isOverdue,
                                  }}
                                  onPrint={() => handlePrint(cobranca)}
                                  onActionComplete={() => load()}
                                  variant="icon"
                                />
                              )}
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
        onSuccess={load}
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
      <IconButton aria-label="Página anterior" disabled={page === 1} onClick={() => onChange(clamp(page - 1))}>
        <ChevronLeft className="h-4 w-4" />
      </IconButton>

      {pages.map((p, idx) =>
        p === '…' ? (
          <span key={`e-${idx}`} className="px-2 text-brand-accent/50">…</span>
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

      <IconButton aria-label="Próxima página" disabled={page === totalPages} onClick={() => onChange(clamp(page + 1))}>
        <ChevronRight className="h-4 w-4" />
      </IconButton>
      <IconButton aria-label="Última página" disabled={page === totalPages} onClick={() => onChange(totalPages)}>
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
