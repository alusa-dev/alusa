'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import TableLayout from '@/components/layout/TableLayout';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import Pagination from '@/components/layout/Pagination';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, User, X } from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import { maskCpf } from '@alusa/lib/client';

interface PessoaComPagamentos {
  id: string;
  tipo: 'ALUNO' | 'RESPONSAVEL';
  nome: string;
  cpf: string | null;
  cpfMasked?: string | null;
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
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'RECEIVED', label: 'Recebida' },
  { value: 'RECEIVED_IN_CASH', label: 'Recebida em dinheiro' },
  { value: 'PAGO', label: 'Pago manual/local' },
  { value: 'ESTORNADO', label: 'Estornado' },
];

const PAGE_SIZE = 20;

const getAvatarSrc = (pessoa: PessoaComPagamentos) => pessoa.avatarUrl ?? pessoa.foto;
const getPessoaHref = (pessoa: PessoaComPagamentos) =>
  pessoa.tipo === 'RESPONSAVEL'
    ? `/financeiro/pagamentos/responsavel/${pessoa.id}`
    : `/financeiro/pagamentos/${pessoa.id}`;

const formatCpf = (pessoa: PessoaComPagamentos) =>
  pessoa.cpfMasked ?? (pessoa.cpf ? maskCpf(pessoa.cpf) : '—');

export default function FinanceiroPagamentosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pessoas, setPessoas] = useState<PessoaComPagamentos[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
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
        setPessoas([]);
        return;
      }

      const payload = await res.json();
      setPessoas(payload.data || []);
      setTotal(payload.total || 0);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({ title: 'Erro', description: errMsg, variant: 'error' });
      setPessoas([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, statusFilter]);

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

  const columns = useMemo<DataTableColumn<PessoaComPagamentos>[]>(
    () => [
      {
        id: 'pessoa',
        header: 'Cliente',
        width: 'min-w-0 lg:w-[30%]',
        align: 'left',
        noWrap: false,
        skeleton: (
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="h-9 w-9 rounded-full bg-gray-200 lg:h-10 lg:w-10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 rounded bg-gray-200" />
              <div className="h-3 w-28 rounded bg-gray-200 lg:hidden" />
            </div>
          </div>
        ),
        render: (pessoa) => (
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <PersonAvatar
              name={pessoa.nome}
              src={getAvatarSrc(pessoa)}
              size="md"
              className="h-9 w-9 lg:h-10 lg:w-10"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-normal text-gray-900">{pessoa.nome}</div>
              <div className="mt-0.5 text-[12px] tabular-nums leading-snug text-gray-500 lg:hidden">
                {formatCpf(pessoa)}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'cpf',
        header: 'CPF',
        width: 'lg:w-[14%]',
        align: 'center',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (pessoa) => (
          <span className="tabular-nums leading-[20px]">{formatCpf(pessoa)}</span>
        ),
        skeleton: <div className="hidden h-4 w-24 rounded bg-gray-200 lg:block" />,
      },
      {
        id: 'historico',
        header: 'Histórico',
        width: 'lg:w-[14%]',
        align: 'center',
        render: (pessoa) => (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[12px] font-medium text-gray-700">
            {pessoa.pagamentosCount} pagos
          </span>
        ),
        skeleton: <div className="mx-auto h-4 w-16 rounded bg-gray-200" />,
      },
      {
        id: 'total',
        header: 'Total pago',
        width: 'lg:w-[16%]',
        align: 'center',
        render: (pessoa) => (
          <span className="font-medium tabular-nums text-gray-900">
            {formatCurrency(pessoa.valorTotal)}
          </span>
        ),
        skeleton: <div className="mx-auto h-4 w-20 rounded bg-gray-200" />,
      },
      {
        id: 'ultima',
        header: 'Última',
        width: 'lg:w-[14%]',
        align: 'center',
        render: (pessoa) => (
          <span className="tabular-nums text-gray-700">
            {pessoa.ultimoPagamento ? formatDate(pessoa.ultimoPagamento) : '—'}
          </span>
        ),
        skeleton: <div className="mx-auto h-4 w-20 rounded bg-gray-200" />,
      },
    ],
    [],
  );

  return (
    <TableLayout
      title="Pagamentos"
      subtitle="Histórico financeiro local por aluno e responsável. Toque em uma pessoa para ver o detalhamento."
      filtersBar={
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-2">
          <div className="relative w-full min-w-0 shrink-0 lg:w-[360px] xl:w-[420px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]" />
            <Input
              placeholder="Buscar por nome..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 rounded-lg border-slate-200 pl-10 pr-10 shadow-none alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                aria-label="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white px-3 text-[13px] text-gray-700 shadow-none lg:min-w-[170px] lg:w-auto alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)]">
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
      }
    >
      <div className="mb-3 flex min-h-6 flex-wrap items-center gap-2 px-1 sm:mb-4">
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

      <div className="alusa-session-panel w-full overflow-hidden rounded-lg border bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
        <DataTable
          columns={columns}
          data={pessoas}
          rowKey={(pessoa) => `${pessoa.tipo}:${pessoa.id}`}
          loading={loading}
          skeletonRows={5}
          onRowClick={(pessoa) => router.push(getPessoaHref(pessoa))}
          emptyMessage={
            <div className="px-6 py-12 text-center text-gray-500">
              <User className="mx-auto mb-3 h-12 w-12 text-gray-400" />
              <p className="text-sm leading-snug">Nenhuma pessoa com histórico financeiro encontrada</p>
              {filtrosAtivos > 0 ? (
                <p className="mt-2 text-xs text-slate-400">Tente ajustar busca ou status.</p>
              ) : null}
            </div>
          }
          ariaLabel="Tabela de pagamentos"
        />
        {!loading && total > PAGE_SIZE ? (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-5 lg:px-6">
            <Pagination total={total} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        ) : null}
      </div>
    </TableLayout>
  );
}
