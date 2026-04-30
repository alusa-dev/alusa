'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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

interface AlunoComPagamentos {
  id: string;
  nome: string;
  cpf: string | null;
  foto: string | null;
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

const getInitials = (nome: string) => {
  const parts = nome.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default function FinanceiroPagamentosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [alunos, setAlunos] = useState<AlunoComPagamentos[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setAlunos([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData();
    }, 300);

    return () => clearTimeout(timer);
  }, [loadData]);

  const filtrosAtivos = [Boolean(searchQuery.trim()), statusFilter !== 'TODOS'].filter(Boolean).length;
  const statusLabel =
    STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? 'Todos status';
  const chipsFiltros = [
    searchQuery.trim() ? `Busca: ${searchQuery.trim()}` : null,
    statusFilter !== 'TODOS' ? `Status: ${statusLabel}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 md:text-[24px]">
          Pagamentos
        </h1>
        <p className="text-[13px] text-gray-500">
          Visualize o histórico de pagamentos por aluno. Clique em um aluno para ver o detalhamento.
        </p>
      </div>
      {/* Filtros */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar por nome do aluno..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 border border-gray-300 bg-white pl-10 pr-10 text-[13px] shadow-none"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-700 shadow-none lg:min-w-[170px]">
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

        <div className="mt-4 flex min-h-6 flex-wrap items-center gap-2">
          {chipsFiltros.length > 0 ? (
            chipsFiltros.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700"
              >
                {chip}
              </span>
            ))
          ) : (
            <p className="text-xs text-slate-500">Use a busca e o status para refinar o histórico.</p>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <>
            {/* Header da tabela (skeleton) */}
            <div className="border-b bg-gray-50 px-6 py-3">
              <div className="grid grid-cols-12 gap-4">
                <Skeleton className="col-span-4 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-3 h-4" />
                <Skeleton className="col-span-2 h-4" />
                <Skeleton className="col-span-1 h-4" />
              </div>
            </div>
            {/* Linhas (skeleton) */}
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                  <Skeleton className="col-span-2 h-4 w-12 mx-auto" />
                  <Skeleton className="col-span-3 h-4 w-28 mx-auto" />
                  <Skeleton className="col-span-2 h-4 w-24 mx-auto" />
                  <Skeleton className="col-span-1 h-4 w-4 ml-auto" />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {/* Cabeçalho da tabela */}
            <div className="border-b bg-gray-50 px-6 py-3">
              <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-4">Aluno</div>
                <div className="col-span-2 text-center">Histórico</div>
                <div className="col-span-3 text-center">Total Pago</div>
                <div className="col-span-2 text-center">Última Movimentação</div>
                <div className="col-span-1" />
              </div>
            </div>

            {/* Linhas */}
            <div className="divide-y">
              {alunos.length === 0 ? (
                <div className="px-6 py-14 text-center text-gray-500">
                  <User className="mx-auto h-12 w-12 text-gray-400 mb-3" />
                  <p className="text-sm">Nenhum aluno com histórico de pagamento encontrado</p>
                </div>
              ) : (
                alunos.map((aluno) => (
                  <div
                    key={aluno.id}
                    className="group cursor-pointer bg-white px-6 py-4 transition-colors hover:bg-gray-50"
                    onClick={() => router.push(`/financeiro/pagamentos/${aluno.id}`)}
                  >
                    <div className="grid grid-cols-12 gap-4 items-center">
                      {/* Aluno */}
                      <div className="col-span-4 flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={aluno.foto || undefined} alt={aluno.nome} />
                          <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                            {getInitials(aluno.nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-normal text-gray-900 text-[13px] truncate">
                            {aluno.nome}
                          </div>
                          {aluno.cpf && (
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              CPF:{' '}
                              {aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Quantidade de Pagamentos */}
                      <div className="col-span-2 text-center">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-700">
                          {aluno.pagamentosCount} itens
                        </span>
                      </div>

                      {/* Valor Total */}
                      <div className="col-span-3 text-center text-[13px] font-medium text-gray-900">
                        {formatCurrency(aluno.valorTotal)}
                      </div>

                      {/* Último Pagamento */}
                      <div className="col-span-2 text-center text-[13px] text-gray-700">
                        {aluno.ultimoPagamento ? formatDate(aluno.ultimoPagamento) : '—'}
                      </div>

                      <div className="col-span-1 flex justify-end">
                        <ChevronRight className="h-4 w-4 text-gray-300 transition-colors group-hover:text-violet-600" />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
