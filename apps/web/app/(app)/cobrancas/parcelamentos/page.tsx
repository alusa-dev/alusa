'use client';

/**
 * Página: Cobranças → Parcelamentos
 *
 * Exibe a lista de parcelamentos (InstallmentPlans) agrupados.
 * Cada item representa o parcelamento pai, não a parcela individual.
 * Inspirado no modelo do Asaas.
 *
 * Domínio: Navegação / Agregação
 * Esta página agrupa visualmente os parcelamentos sem alterar entidades financeiras.
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search,
  Filter,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from '@/components/icons/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { pushToast } from '@/components/ui/toast';
import { CreateChargeModal } from '@/components/financeiro/CreateChargeModal';
import { InstallmentActionsMenu } from '@/components/financeiro/InstallmentActionsMenu';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import type { FinanceInstallmentAggregatedItemDTO } from '@/features/finance/dtos';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('pt-BR');
};

type StatusParcelamento = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

const statusLabels: Record<StatusParcelamento, string> = {
  EM_DIA: 'Em dia',
  ATRASADO: 'Atrasado',
  QUITADO: 'Quitado',
  CANCELADO: 'Cancelado',
};

const statusColors: Record<StatusParcelamento, string> = {
  EM_DIA: 'bg-blue-100 text-blue-700',
  ATRASADO: 'bg-red-100 text-red-700',
  QUITADO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
};

type Parcelamento = FinanceInstallmentAggregatedItemDTO;

export default function ParcelamentosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(true);
  const [parcelamentos, setParcelamentos] = useState<Parcelamento[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(12);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get('status') || 'all';
  const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (searchQuery) {
        params.set('q', searchQuery);
      }
      const res = await fetch(`/api/finance/installments/aggregated?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg =
          typeof data?.error === 'string'
            ? data.error
            : data?.error?.message || 'Falha ao carregar parcelamentos';
        pushToast({
          title: 'Erro',
          description: errorMsg,
          variant: 'error',
        });
        setParcelamentos([]);
        return;
      }
      const payload = await res.json().catch(() => null);
      setParcelamentos((payload && payload.data) || []);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setParcelamentos([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusFilterChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'all') {
        params.delete('status');
      } else {
        params.set('status', value);
      }
      router.replace(`/cobrancas/parcelamentos?${params.toString()}`);
      setPage(1);
    },
    [searchParams, router],
  );

  const orderedParcelamentos = useMemo(() => {
    const items = [...parcelamentos];
    items.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      return ta - tb;
    });
    if (sortOrder === 'DESC') items.reverse();
    return items;
  }, [parcelamentos, sortOrder]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
            Parcelamentos
          </h1>
          <p className="text-[13px] text-gray-500">
            Visualize e gerencie parcelamentos. Clique em um parcelamento para ver todas as parcelas.
          </p>
        </div>
        <div className="flex justify-start md:justify-end">
          <AsaasSeal variant="negativo-preto" />
        </div>
      </div>
      {/* Barra de filtros */}
      <div className="bg-white rounded-xl border px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
            {/* Filtro de Ordenação */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 px-4 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-none"
                >
                  <Filter className="h-4 w-4 mr-2" /> Ordenar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Ordenar por data
                </div>
                <DropdownMenuItem
                  onClick={() => setSortOrder('DESC')}
                  className={'justify-between ' + (sortOrder === 'DESC' ? 'text-brand-accent' : '')}
                >
                  Mais recente primeiro
                  {sortOrder === 'DESC' ? <CheckCircle className="h-4 w-4" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortOrder('ASC')}
                  className={'justify-between ' + (sortOrder === 'ASC' ? 'text-brand-accent' : '')}
                >
                  Mais antigo primeiro
                  {sortOrder === 'ASC' ? <CheckCircle className="h-4 w-4" /> : null}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Filtro de Status */}
            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="h-10 w-full md:w-auto md:min-w-[150px] md:max-w-[190px] shrink-0 whitespace-nowrap bg-white text-gray-700 border border-gray-300 shadow-none px-3">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent align="end" className="text-[13px]">
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="ACTIVE">Em andamento</SelectItem>
                <SelectItem value="COMPLETED">Quitados</SelectItem>
                <SelectItem value="CANCELED">Cancelados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex w-full md:ml-auto md:flex-1 md:items-center md:justify-end gap-3">
            {/* Busca */}
            <div className="relative w-full md:max-w-[360px] lg:max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por aluno..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 pl-10 border border-gray-300 shadow-none"
              />
            </div>

            <Button
              className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
              onClick={() => setCreateModalOpen(true)}
            >
              Adicionar parcelamento
            </Button>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <>
            <div className="bg-gray-50 px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4">
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-1 h-4" />
              </div>
            </div>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-3">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <Skeleton className="col-span-3 h-4 w-40" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-4 w-20" />
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-6 w-20 rounded-full" />
                  <Skeleton className="col-span-1 h-4 w-8" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="bg-gray-50 px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-3">Aluno</div>
                <div className="col-span-2 text-center">Valor Total</div>
                <div className="col-span-2 text-center">Parcelas</div>
                <div className="col-span-2 text-center">Próx. Vencimento</div>
                <div className="col-span-2 text-center">Status</div>
                <div className="col-span-1 text-center"></div>
              </div>
            </div>

            <div className="divide-y">
              {orderedParcelamentos.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhum parcelamento encontrado
                </div>
              ) : (
                orderedParcelamentos.slice((page - 1) * pageSize, page * pageSize).map((p) => (
                  <div
                    key={p.id}
                    className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white cursor-pointer"
                    onClick={() => router.push(`/cobrancas/parcelamentos/${p.id}`)}
                  >
                    <div className="grid grid-cols-12 gap-4 items-center">
                      {/* Aluno */}
                      <div className="col-span-3">
                        <div className="font-medium text-gray-900 text-[13px] truncate">
                          {p.studentName}
                        </div>
                      </div>

                      {/* Valor Total */}
                      <div className="col-span-2 text-[13px] text-gray-900 text-center font-semibold">
                        {formatCurrency(p.totalValue)}
                      </div>

                      {/* Parcelas */}
                      <div className="col-span-2 text-[13px] text-gray-700 text-center">
                        <span className="font-medium">{p.installmentsPaid}</span>
                        <span className="text-gray-400"> / {p.installmentCount}</span>
                      </div>

                      {/* Próximo Vencimento */}
                      <div className="col-span-2 text-center">
                        <div className="text-[13px] text-gray-700">
                          {p.proximoVencimento ? formatDate(p.proximoVencimento) : '-'}
                        </div>
                      </div>

                      {/* Status */}
                      <div className="col-span-2 flex justify-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[p.statusConsolidado]}`}
                        >
                          {statusLabels[p.statusConsolidado]}
                        </span>
                      </div>

                      {/* Ação */}
                      <div className="col-span-1 flex justify-center">
                        <div onClick={(event) => event.stopPropagation()}>
                          <InstallmentActionsMenu
                            installmentId={p.id}
                            asaasInstallmentId={(p as { asaasInstallmentId?: string | null }).asaasInstallmentId ?? null}
                            statusConsolidado={p.statusConsolidado}
                            matriculaId={p.matriculaId}
                            contratoId={p.contratoId}
                            onActionComplete={() => load()}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Paginação */}
      {orderedParcelamentos.length > 0 && (
        <Pagination
          totalItems={orderedParcelamentos.length}
          pageSize={pageSize}
          page={page}
          onChange={setPage}
        />
      )}

      <CreateChargeModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onSuccess={() => {
          setPage(1);
          void load();
        }}
        defaultChargeType="INSTALLMENT"
      />
    </div>
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
    <div className="flex items-center justify-center py-6">
      <div className="flex items-center gap-2 text-sm">
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
