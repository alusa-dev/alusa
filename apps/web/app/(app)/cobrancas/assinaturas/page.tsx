'use client';

/**
 * Página: Cobranças → Assinaturas
 *
 * Exibe lista de assinaturas (1 linha por assinatura).
 * Espelha o modelo do Asaas: lista pais, detalhe mostra filhas.
 *
 * Domínio: Navegação
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
  const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');
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
    [searchParams, router]
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
            Assinaturas
          </h1>
          <p className="text-[13px] text-gray-500">
            Cobranças recorrentes (acadêmicas e manuais) com sincronização financeira automática.
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
            <Select value={statusFilter || 'all'} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="h-10 w-full md:w-auto md:min-w-[150px] md:max-w-[190px] shrink-0 whitespace-nowrap bg-white text-gray-700 border border-gray-300 shadow-none px-3">
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

          <div className="flex w-full md:ml-auto md:flex-1 md:items-center md:justify-end gap-3">
            {/* Busca */}
            <div className="relative w-full md:max-w-[360px] lg:max-w-[420px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por aluno..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="h-10 pl-10 border border-gray-300 shadow-none"
              />
            </div>

            <Button
              className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
              onClick={() => setCreateModalOpen(true)}
            >
              Adicionar assinatura
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
                  <Skeleton className="col-span-2 h-4 w-24" />
                  <Skeleton className="col-span-2 h-4 w-20" />
                  <Skeleton className="col-span-2 h-4 w-20" />
                  <Skeleton className="col-span-1 h-8 w-8" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="bg-gray-50 px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-3">Aluno</div>
                <div className="col-span-2 text-center">Valor</div>
                <div className="col-span-2 text-center">Descrição</div>
                <div className="col-span-2 text-center">Tipo</div>
                <div className="col-span-2 text-center">Forma Pgto.</div>
                <div className="col-span-1 text-center">Ações</div>
              </div>
            </div>

            <div className="divide-y">
              {orderedAssinaturas.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhuma assinatura encontrada
                </div>
              ) : (
                orderedAssinaturas.map((assinatura) => (
                  <Link
                    key={assinatura.id}
                    href={`/cobrancas/assinaturas/${assinatura.id}`}
                    className="block px-6 py-3 hover:bg-gray-50 transition-colors bg-white"
                  >
                    <div className="grid grid-cols-12 gap-4 items-center">
                      {/* Aluno */}
                      <div className="col-span-3">
                        <div className="font-medium text-gray-900 text-[13px] truncate">
                          {assinatura.alunoNome}
                        </div>
                      </div>

                      {/* Valor / Ciclo */}
                      <div className="col-span-2 text-center">
                        <div className="text-[13px] text-gray-900 font-semibold">
                          {formatCurrency(assinatura.valor)}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {assinatura.cycleLabel}
                        </div>
                      </div>

                      {/* Descrição */}
                      <div className="col-span-2 text-center">
                        <div className="text-[13px] text-gray-700 truncate">
                          {formatAssinaturaDescription(assinatura)}
                        </div>
                      </div>

                      {/* Tipo */}
                      <div className="col-span-2 text-center">
                        <div className="text-[13px] text-gray-700">
                          {TIPO_LABELS[assinatura.tipo ?? ''] ?? assinatura.tipo ?? 'Plano'}
                        </div>
                      </div>

                      {/* Forma de pagamento */}
                      <div className="col-span-2 text-center">
                        <div className="text-[13px] text-gray-700">
                          {formatFormaPagamentoLabel(assinatura.billingType)}
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="col-span-1 flex justify-center">
                        <div onClick={(event) => event.preventDefault()}>
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
                  </Link>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Paginação */}
      {total > 0 && (
        <Pagination
          totalItems={total}
          pageSize={pageSize}
          page={page}
          totalPages={totalPages}
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
        defaultChargeType="SUBSCRIPTION"
      />
    </div>
  );
}

function Pagination({
  totalItems,
  pageSize,
  page,
  totalPages,
  onChange,
}: {
  totalItems: number;
  pageSize: number;
  page: number;
  totalPages: number;
  onChange: (_p: number) => void;
}) {
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
    <div className="flex items-center justify-between py-4">
      <div className="text-sm text-gray-500">
        Mostrando {Math.min((page - 1) * pageSize + 1, totalItems)} a{' '}
        {Math.min(page * pageSize, totalItems)} de {totalItems}
      </div>
      <div className="flex items-center gap-2 text-sm">
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
          )
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
