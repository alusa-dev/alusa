'use client';

/**
 * Página: Cobranças → Avulsas
 *
 * Exibe apenas cobranças avulsas (tipo AVULSA ou standalone).
 * Reutiliza a estrutura de listagem existente com filtro pré-aplicado.
 *
 * Domínio: Navegação
 * Separação clara de cobranças independentes (não vinculadas a parcelamento/assinatura).
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
  Plus,
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
import { Badge, type StatusType } from '@/components/ui/badge';
import { pushToast } from '@/components/ui/toast';
import { CobrancaActionsMenu } from '@/components/financeiro/CobrancaActionsMenu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateChargeModal } from '@/components/financeiro/CreateChargeModal';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

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

type Cobranca = {
  id: string;
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
  const [loading, setLoading] = useState<boolean>(true);
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(12);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchParams = useSearchParams();
  const statusView = searchParams.get('view') || 'open';
  const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');

  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
    action?: () => Promise<void> | void;
  }>({ open: false, title: '', description: '', variant: 'default', action: async () => {} });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('statusView', statusView);
      params.set('scope', 'standalone');
      const res = await fetch(`/api/financeiro/cobrancas?${params.toString()}`, { cache: 'no-store' });
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setCobrancas([]);
    } finally {
      setLoading(false);
    }
  }, [statusView]);

  useEffect(() => {
    void load();
  }, [load]);

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
        return name.includes(q) || c.id.toLowerCase().includes(q);
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

  const statusMap: Record<string, StatusType> = {
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1 className="text-[22px] md:text-[24px] font-semibold tracking-tight text-gray-900">
            Cobranças Avulsas
          </h1>
          <p className="text-[13px] text-gray-500">
            Cobranças independentes, não vinculadas a parcelamentos ou assinaturas.
          </p>
        </div>
        <div className="flex justify-start md:justify-end">
          <AsaasSeal variant="negativo-preto" />
        </div>
      </div>
      {/* Barra de ações e filtros */}
      <div className="bg-white rounded-xl border px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              onClick={handleCreateCharge}
              className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white shadow-none"
              aria-label="Gerar nova cobrança avulsa"
              disabled={actionLoading}
            >
              <Plus className="h-4 w-4 mr-2" />
              Nova cobrança avulsa
            </Button>
          </div>
          <div className="flex-1 md:flex-none w-full md:w-auto">
            <div className="flex w-full flex-col gap-3 md:flex-row md:items-center">
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
                      Ordenar por vencimento
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

                {/* Filtro de Visualização */}
                <Select value={statusView} onValueChange={handleStatusViewChange}>
                  <SelectTrigger className="h-10 w-full md:w-auto md:min-w-[150px] md:max-w-[190px] shrink-0 whitespace-nowrap bg-white text-gray-700 border border-gray-300 shadow-none px-3">
                    <SelectValue placeholder="Em aberto" />
                  </SelectTrigger>
                  <SelectContent align="end" className="text-[13px]">
                    <SelectItem value="open">Em aberto</SelectItem>
                    <SelectItem value="paid">Pagas</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Busca */}
              <div className="relative w-full md:ml-auto md:flex-1 md:max-w-[360px] lg:max-w-[420px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar por cliente ou descrição..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 pl-10 border border-gray-300 shadow-none"
                />
              </div>
            </div>
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
                  <Skeleton className="col-span-1 h-8 w-8" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="bg-gray-50 px-6 py-3 border-b">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-3">Cliente</div>
                <div className="col-span-2 text-center">Valor</div>
                <div className="col-span-2 text-center">Tipo</div>
                <div className="col-span-2 text-center">Vencimento</div>
                <div className="col-span-2 text-center">Status</div>
                <div className="col-span-1 text-center">Ações</div>
              </div>
            </div>

            <div className="divide-y">
              {orderedCobrancas.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  Nenhuma cobrança avulsa encontrada
                </div>
              ) : (
                orderedCobrancas.slice((page - 1) * pageSize, page * pageSize).map((cobranca) => (
                  <div
                    key={cobranca.id}
                    className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white cursor-pointer"
                    onClick={() => router.push(`/cobrancas/${cobranca.id}`)}
                  >
                    <div className="grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-3">
                        <div className="font-medium text-gray-900 text-[13px] truncate">
                          {cobranca.aluno?.nome ?? 'Cliente não identificado'}
                        </div>
                      </div>
                      <div className="col-span-2 text-[13px] text-gray-900 text-center font-semibold">
                        {formatCurrency(cobranca.valor)}
                      </div>
                      <div className="col-span-2 text-[13px] text-gray-700 text-center">
                        {getTipoLabel(cobranca.tipo, cobranca.origin)}
                      </div>
                      <div className="col-span-2 text-center">
                        <div className={`text-[13px] ${cobranca.atrasado ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                          {formatDate(cobranca.vencimento ?? '')}
                        </div>
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <Badge
                          status={(() => {
                            const base = cobranca.status ?? 'PENDENTE';
                            if (base === 'PAGO' && cobranca.liquidacaoStatus === 'DISPONIVEL') {
                              return 'RECEIVED';
                            }
                            return statusMap[base] ?? 'PENDING';
                          })()}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
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
                          onActionComplete={() => load()}
                          variant="icon"
                        />
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
      {orderedCobrancas.length > 0 && (
        <Pagination
          totalItems={orderedCobrancas.length}
          pageSize={pageSize}
          page={page}
          onChange={setPage}
        />
      )}

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
        defaultChargeType="ONE_TIME"
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
