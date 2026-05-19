'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import {
  ChevronLeft as ArrowLeft,
  Download,
  Filter,
  Receipt,
  Search,
  X,
} from '@/components/icons/icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePicker } from '@/components/ui/date-picker';
import { ExportPaidReceiptsDialog } from '@/features/financeiro/pagamentos/ExportPaidReceiptsDialog';
import { PaymentHistorySections } from '@/features/financeiro/pagamentos/PaymentHistorySections';
import {
  PAYMENT_HISTORY_CATEGORY_FILTER_OPTIONS,
} from '@/features/financeiro/pagamentos/payment-history-categories';
import {
  filterHistoricoCobrancas,
  formatCurrency,
  formatDate,
  formatDateInput,
  FORMA_OPTIONS,
  getCategoryLabel,
  resolveForma,
  resolveValorExibido,
  STATUS_OPTIONS,
  toDateValue,
  toIsoDate,
  type HistoricoCobranca,
} from '@/features/financeiro/pagamentos/payment-history-utils';
import type {
  FinanceiroPagamentoAlunoResumoDTO,
  FinanceiroPagamentoHistoricoResumoDTO,
} from '@/features/financeiro/dtos';

const TIPO_OPTIONS = [{ value: 'TODOS', label: 'Todas categorias' }, ...PAYMENT_HISTORY_CATEGORY_FILTER_OPTIONS];

export function PagamentoAlunoDetalhesClient({ alunoId }: { alunoId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [aluno, setAluno] = useState<FinanceiroPagamentoAlunoResumoDTO | null>(null);
  const [cobrancas, setCobrancas] = useState<HistoricoCobranca[]>([]);
  const [resumo, setResumo] = useState<FinanceiroPagamentoHistoricoResumoDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [categoryFilter, setCategoryFilter] = useState('TODOS');
  const [formaFilter, setFormaFilter] = useState('TODOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [exportReceiptsOpen, setExportReceiptsOpen] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/financeiro/pagamentos/aluno/${alunoId}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error?.message || 'Erro ao carregar dados');
        }
        const payload = await res.json();
        setAluno(payload.data.aluno);
        setCobrancas(payload.data.cobrancas || []);
        setResumo(payload.data.resumo);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [alunoId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useFinanceLiveRefresh(() => load(true), {
    enabled: Boolean(aluno) && !loading,
    intervalMs: 45_000,
    minIntervalMs: 10_000,
    realtime: { dashboard: true, portal: false },
  });

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <Skeleton className="h-5 w-24" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-52" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-20 w-44 rounded-2xl" />
            <Skeleton className="h-20 w-36 rounded-2xl" />
          </div>
        </div>
        <Skeleton className="h-14 w-full rounded-xl" />
        {[1, 2, 3].map((item) => (
          <div key={item} className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !aluno) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="mb-1 text-lg font-medium text-gray-900">Erro ao carregar dados</p>
          <p className="text-sm text-gray-500">{error || 'Aluno não encontrado'}</p>
        </div>
      </div>
    );
  }

  const filtradas = filterHistoricoCobrancas(cobrancas, {
    searchTerm,
    dataInicio,
    dataFim,
    statusFilter,
    categoryFilter,
    formaFilter,
  });

  const totalPagoFiltrado = filtradas.reduce(
    (sum, cobranca) => sum + (cobranca.pagamento ? cobranca.pagamento.valorPago : 0),
    0,
  );
  const totalFiltrado = filtradas.length;
  const filtrosAtivos = [
    Boolean(searchTerm.trim()),
    Boolean(dataInicio),
    Boolean(dataFim),
    statusFilter !== 'TODOS',
    categoryFilter !== 'TODOS',
    formaFilter !== 'TODOS',
  ].filter(Boolean).length;

  const chipsFiltros = [
    searchTerm.trim() ? `Busca: ${searchTerm.trim()}` : null,
    dataInicio ? `De: ${formatDateInput(dataInicio)}` : null,
    dataFim ? `Até: ${formatDateInput(dataFim)}` : null,
    statusFilter !== 'TODOS'
      ? STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? statusFilter
      : null,
    categoryFilter !== 'TODOS'
      ? TIPO_OPTIONS.find((option) => option.value === categoryFilter)?.label ?? categoryFilter
      : null,
    formaFilter !== 'TODOS'
      ? FORMA_OPTIONS.find((option) => option.value === formaFilter)?.label ?? formaFilter
      : null,
  ].filter(Boolean) as string[];

  const exportarCSV = () => {
    const headers = [
      'Categoria',
      'Descrição',
      'Valor',
      'Vencimento',
      'Data Pagamento',
      'Forma',
      'Pagador',
      'Status',
    ];
    const rows = filtradas.map((cobranca) => [
      getCategoryLabel(cobranca.category),
      cobranca.description ?? '',
      formatCurrency(resolveValorExibido(cobranca)),
      formatDate(cobranca.vencimento),
      formatDate(cobranca.pagamento?.dataPagamento ?? null),
      resolveForma(cobranca),
      cobranca.payerName,
      cobranca.pagamento ? cobranca.pagamento.status : cobranca.status,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${value}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pagamentos-${aluno.nome.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 pb-16">
      <div className="space-y-6">
        <button
          onClick={() => router.back()}
          className="group flex items-center gap-2 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white transition-colors group-hover:border-slate-300">
            <ArrowLeft className="h-3.5 w-3.5" />
          </div>
          Voltar para listagem
        </button>

        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <PersonAvatar
              name={aluno.nome}
              src={aluno.avatarUrl ?? aluno.foto}
              size="xl"
              className="border-2 border-white"
              fallbackClassName="bg-[linear-gradient(135deg,#9333ea_0%,#7c3aed_100%)] text-xl font-bold text-white"
            />
            <div className="space-y-1">
              <h1 className="text-[24px] font-bold tracking-tight text-slate-900">Histórico de Pagamento</h1>
              <div className="flex items-center gap-2 text-[14px] text-slate-500">
                <span className="font-semibold text-slate-700">{aluno.nome}</span>
                {aluno.cpf ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex min-w-[120px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a7ab0]">Total Pago</span>
              <span className="text-[18px] font-semibold tracking-tight text-[#2b2634]">
                {formatCurrency(totalPagoFiltrado)}
              </span>
            </div>
            <div className="flex min-w-[120px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a7ab0]">Lançamentos</span>
              <div className="flex items-baseline gap-1.5 text-[#2b2634]">
                <span className="text-[18px] font-semibold tracking-tight">{totalFiltrado}</span>
                {resumo && resumo.total !== totalFiltrado ? (
                  <span className="text-[12px] font-medium text-[#8a7ab0]">/ {resumo.total}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar por categoria, descrição, pagador ou forma de pagamento..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 border border-gray-300 bg-white pl-10 pr-10 text-[13px] shadow-none"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
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

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-md border border-gray-300 bg-white px-4 text-[13px] text-gray-700 shadow-none hover:bg-gray-50"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  Filtros
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[360px] rounded-2xl border-slate-200 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.12)]"
              >
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Refinar histórico</p>
                    <p className="text-xs text-slate-500">Filtre por período, status, categoria e forma.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-slate-500">Data inicial</label>
                      <DatePicker
                        variant="input"
                        value={toDateValue(dataInicio)}
                        onChange={(date) => setDataInicio(toIsoDate(date))}
                        placeholder="dd/mm/aaaa"
                        className="h-10 border-slate-200 text-[13px]"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-slate-500">Data final</label>
                      <DatePicker
                        variant="input"
                        value={toDateValue(dataFim)}
                        onChange={(date) => setDataFim(toIsoDate(date))}
                        placeholder="dd/mm/aaaa"
                        className="h-10 border-slate-200 text-[13px]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-slate-500">Categoria</label>
                      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="h-10 border-slate-200 text-[13px]">
                          <SelectValue placeholder="Todas categorias" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPO_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-slate-500">Forma de pagamento</label>
                      <Select value={formaFilter} onValueChange={setFormaFilter}>
                        <SelectTrigger className="h-10 border-slate-200 text-[13px]">
                          <SelectValue placeholder="Todas formas" />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMA_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {filtrosAtivos > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10 w-full rounded-xl text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      onClick={() => {
                        setSearchTerm('');
                        setDataInicio('');
                        setDataFim('');
                        setStatusFilter('TODOS');
                        setCategoryFilter('TODOS');
                        setFormaFilter('TODOS');
                      }}
                    >
                      Limpar filtros
                    </Button>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              type="button"
              variant="outline"
              title="Exportar CSV"
              className="h-10 rounded-md border border-gray-300 bg-white px-4 text-[13px] text-gray-700 shadow-none hover:bg-gray-50"
              onClick={exportarCSV}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>

            <Button
              type="button"
              title="Exportar comprovantes pagos"
              className="h-10 rounded-md bg-[#5c2f91] px-4 text-[13px] text-white shadow-none hover:bg-[#4b2478]"
              onClick={() => setExportReceiptsOpen(true)}
            >
              <Receipt className="mr-2 h-4 w-4" />
              Comprovantes
            </Button>
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
            <p className="text-xs text-slate-500">
              Use os filtros para refinar o histórico por período, categoria, forma ou status.
            </p>
          )}
        </div>
      </div>

      {cobrancas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-gray-500">Nenhum pagamento encontrado para este aluno.</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-gray-500">Nenhum resultado com os filtros selecionados.</p>
        </div>
      ) : (
        <PaymentHistorySections
          cobrancas={filtradas}
          showEmptyCategories={categoryFilter === 'TODOS'}
        />
      )}

      <ExportPaidReceiptsDialog
        open={exportReceiptsOpen}
        onOpenChange={setExportReceiptsOpen}
        aluno={aluno}
        items={cobrancas}
      />
    </div>
  );
}
