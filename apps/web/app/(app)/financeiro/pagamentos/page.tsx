'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronRight, Search, User, X } from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface AlunoComPagamentos {
  id: string;
  nome: string;
  cpf: string | null;
  foto: string | null;
  avatarUrl?: string | null;
  totalPagamentos: number;
  valorTotal: number;
  ultimoPagamento: string | null;
  pagamentosCount: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string) => {
  try {
    return new Intl.DateTimeFormat('pt-BR').format(new Date(dateStr));
  } catch {
    return '—';
  }
};

const STATUS_OPTIONS = [
  { value: 'TODOS', label: 'Todos status' },
  { value: 'PAGO', label: 'Pago' },
  { value: 'CONFIRMADO', label: 'Confirmado' },
  { value: 'RECEIVED', label: 'Recebido' },
  { value: 'ESTORNADO', label: 'Estornado' },
];

const getAvatarSrc = (aluno: AlunoComPagamentos) => aluno.avatarUrl ?? aluno.foto;

export default function FinanceiroPagamentosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [alunos, setAlunos] = useState<AlunoComPagamentos[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }
      if (statusFilter !== 'TODOS') {
        params.append('status', statusFilter);
      }

      const res = await fetch(`/api/financeiro/pagamentos/summary?${params.toString()}`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushToast({
          title: 'Erro',
          description: data?.error?.message || 'Falha ao carregar dados',
          variant: 'error',
        });
        setAlunos([]);
        return;
      }

      const payload = await res.json();
      setAlunos(payload.data || []);
      setTotal(payload.total || 0);
      setTotalPages(Math.max(1, payload.totalPages || 1));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setAlunos([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchQuery, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 300);

    return () => clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter]);

  const filtrosAtivos = [Boolean(searchQuery.trim()), statusFilter !== 'TODOS'].filter(Boolean).length;
  const statusLabel =
    STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? 'Todos status';
  const chipsFiltros = [
    searchQuery.trim() ? `Busca: ${searchQuery.trim()}` : null,
    statusFilter !== 'TODOS' ? `Status: ${statusLabel}` : null,
  ].filter(Boolean) as string[];

  const cellX = 'px-4 md:px-6';

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-6">
      {/* Título + filtros no mesmo bloco: alinhamento consistente no mobile */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="space-y-1 pb-4">
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-[22px] md:text-2xl">
            Pagamentos
          </h1>
          <p className="text-[13px] leading-snug text-gray-500 sm:max-w-2xl">
            Histórico por aluno. Toque em um aluno para ver o detalhamento.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 sm:left-4" />
              <Input
                placeholder="Buscar por nome..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 border border-gray-300 bg-white pl-9 pr-10 text-[13px] shadow-none sm:h-10 sm:pl-10"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700 sm:right-4"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap lg:shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-[13px] text-gray-700 shadow-none sm:h-10 lg:min-w-[170px]">
                <SelectValue placeholder="Todos status" />
              </SelectTrigger>
              <SelectContent align="end">
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-2 sm:mt-4">
          {chipsFiltros.length > 0 ? (
            chipsFiltros.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 sm:px-3 sm:text-xs"
              >
                {chip}
              </span>
            ))
          ) : (
            <p className="text-[11px] leading-snug text-slate-500 sm:text-xs">
              Use a busca e o status para refinar o histórico.
            </p>
          )}
        </div>
      </div>

      {/* Lista (mobile: cartões) / tabela (md+) */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <>
            {/* Skeleton desktop */}
            <div className="hidden md:block">
              <div className={cn('border-b bg-gray-50 py-3', cellX)}>
                <div className="grid grid-cols-12 gap-4">
                  <Skeleton className="col-span-4 h-4" />
                  <Skeleton className="col-span-2 h-4" />
                  <Skeleton className="col-span-3 h-4" />
                  <Skeleton className="col-span-2 h-4" />
                  <Skeleton className="col-span-1 h-4" />
                </div>
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className={cn('py-4', cellX)}>
                  <div className="grid grid-cols-12 items-center gap-4">
                    <div className="col-span-4 flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </div>
                    <Skeleton className="col-span-2 mx-auto h-4 w-12" />
                    <Skeleton className="col-span-3 mx-auto h-4 w-28" />
                    <Skeleton className="col-span-2 mx-auto h-4 w-24" />
                    <Skeleton className="col-span-1 ml-auto h-4 w-4" />
                  </div>
                </div>
              ))}
            </div>
            {/* Skeleton mobile */}
            <div className="divide-y md:hidden">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex gap-3 px-4 py-4">
                  <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-[85%] max-w-xs" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-full max-w-[12rem]" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Cabeçalho tabela — só md+ */}
            <div className={cn('hidden border-b bg-gray-50 py-3 md:block', cellX)}>
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                <div className="col-span-4">Aluno</div>
                <div className="col-span-2 text-center">Histórico</div>
                <div className="col-span-3 text-center">Total pago</div>
                <div className="col-span-2 text-center">Última</div>
                <div className="col-span-1" />
              </div>
            </div>

            <div className="divide-y">
              {alunos.length === 0 ? (
                <div className={cn('py-12 text-center text-gray-500 sm:py-14', cellX)}>
                  <User className="mx-auto mb-3 h-12 w-12 text-gray-400" />
                  <p className="text-sm leading-snug">Nenhum aluno com histórico de pagamento encontrado</p>
                  {filtrosAtivos > 0 ? (
                    <p className="mt-2 text-xs text-slate-400">Tente ajustar busca ou status.</p>
                  ) : null}
                </div>
              ) : (
                <>
                  {/* Mobile: cartões */}
                  <div className="md:hidden">
                    {alunos.map((aluno) => (
                      <button
                        key={aluno.id}
                        type="button"
                        className="group flex w-full gap-3 px-4 py-4 text-left transition-colors active:bg-gray-50"
                        onClick={() => router.push(`/financeiro/pagamentos/${aluno.id}`)}
                      >
                        <PersonAvatar
                          name={aluno.nome}
                          src={getAvatarSrc(aluno)}
                          size="lg"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="line-clamp-2 text-[14px] font-medium leading-snug text-gray-900">
                              {aluno.nome}
                            </span>
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-violet-600" />
                          </div>
                          {aluno.cpf ? (
                            <p className="mt-0.5 text-[11px] text-gray-500">
                              {aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-col gap-1.5 text-[12px]">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                                {aluno.pagamentosCount} pagamentos
                              </span>
                              <span className="font-semibold tabular-nums text-gray-900">
                                {formatCurrency(aluno.valorTotal)}
                              </span>
                            </div>
                            <p className="text-gray-600">
                              <span className="text-gray-500">Última: </span>
                              {aluno.ultimoPagamento ? formatDate(aluno.ultimoPagamento) : '—'}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Desktop: tabela */}
                  <div className="hidden md:block">
                    {alunos.map((aluno) => (
                      <div
                        key={aluno.id}
                        className="group cursor-pointer bg-white px-6 py-4 transition-colors hover:bg-gray-50"
                        onClick={() => router.push(`/financeiro/pagamentos/${aluno.id}`)}
                      >
                        <div className="grid grid-cols-12 items-center gap-4">
                          <div className="col-span-4 flex items-center gap-3">
                            <PersonAvatar
                              name={aluno.nome}
                              src={getAvatarSrc(aluno)}
                              size="md"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-normal text-gray-900">{aluno.nome}</div>
                              {aluno.cpf ? (
                                <p className="mt-0.5 text-[11px] text-gray-500">
                                  CPF:{' '}
                                  {aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="col-span-2 text-center">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-700">
                              {aluno.pagamentosCount} itens
                            </span>
                          </div>

                          <div className="col-span-3 text-center text-[13px] font-medium text-gray-900">
                            {formatCurrency(aluno.valorTotal)}
                          </div>

                          <div className="col-span-2 text-center text-[13px] text-gray-700">
                            {aluno.ultimoPagamento ? formatDate(aluno.ultimoPagamento) : '—'}
                          </div>

                          <div className="col-span-1 flex justify-end">
                            <ChevronRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-violet-600" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 text-[13px] text-gray-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {total === 0 ? 'Nenhum registro' : `${total} aluno${total === 1 ? '' : 's'} com histórico`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-gray-300 px-3 text-[13px]"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </Button>
          <span className="min-w-20 text-center tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg border-gray-300 px-3 text-[13px]"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
