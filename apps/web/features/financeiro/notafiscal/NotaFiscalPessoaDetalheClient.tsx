'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft as ArrowLeft } from '@/components/icons/icons';
import { NotaFiscalStatusFilters } from '@/features/financeiro/notafiscal/components/NotaFiscalStatusFilters';
import { NotaFiscalTable } from '@/features/financeiro/notafiscal/components/NotaFiscalTable';
import type { NotaFiscalPessoaDetalheResultDTO } from '@/features/financeiro/notafiscal/dtos';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const dadosSectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const dadosLabelClass = 'text-xs font-medium text-slate-600';
const dadosInputDisabledClass =
  'h-10 w-full rounded-lg border border-gray-200 bg-gray-100 px-3 text-sm text-gray-500 shadow-none disabled:opacity-100 disabled:cursor-not-allowed';

type PersonType = 'ALUNO' | 'RESPONSAVEL';

type NotaFiscalPessoaDetalheClientProps = {
  personType: PersonType;
  personId?: string;
};

function ReadOnlyField({
  label,
  value,
  placeholder = 'Não informado',
}: {
  label: string;
  value: string;
  placeholder?: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label className={dadosLabelClass}>{label}</label>
      <Input
        value={value}
        disabled
        readOnly
        placeholder={placeholder}
        className={dadosInputDisabledClass}
      />
    </div>
  );
}

export function NotaFiscalPessoaDetalheClient({
  personType,
  personId,
}: NotaFiscalPessoaDetalheClientProps) {
  const router = useRouter();
  const hasLoadedOnceRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<NotaFiscalPessoaDetalheResultDTO['data'] | null>(null);
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [effectiveDateFrom, setEffectiveDateFrom] = useState('');
  const [effectiveDateTo, setEffectiveDateTo] = useState('');

  const endpoint = useMemo(() => {
    if (personType === 'RESPONSAVEL') return `/api/financeiro/nota-fiscal/responsavel/${personId}`;
    return `/api/financeiro/nota-fiscal/aluno/${personId}`;
  }, [personType, personId]);

  const pageTitle = useMemo(() => {
    if (personType === 'RESPONSAVEL') return 'Notas fiscais do responsável';
    return 'Notas fiscais do aluno';
  }, [personType]);

  const dadosSectionTitle = useMemo(() => {
    if (personType === 'RESPONSAVEL') return 'Dados do Responsável';
    return 'Dados do Aluno';
  }, [personType]);

  const load = useCallback(async () => {
    const isInitialLoad = !hasLoadedOnceRef.current;
    if (isInitialLoad) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    if (isInitialLoad) {
      setError(null);
    }

    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'TODOS') params.append('status', statusFilter);
      if (effectiveDateFrom) params.set('effectiveDateFrom', effectiveDateFrom);
      if (effectiveDateTo) params.set('effectiveDateTo', effectiveDateTo);

      const query = params.toString();
      const res = await fetch(query ? `${endpoint}?${query}` : endpoint, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || 'Erro ao carregar notas fiscais');
      }

      const json = (await res.json()) as NotaFiscalPessoaDetalheResultDTO;
      setPayload(json.data);
      hasLoadedOnceRef.current = true;
      setError(null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Erro desconhecido';
      if (!hasLoadedOnceRef.current) {
        setError(message);
        setPayload(null);
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [endpoint, statusFilter, effectiveDateFrom, effectiveDateTo]);

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    setLoading(true);
    setIsRefreshing(false);
    setError(null);
    setPayload(null);
    setStatusFilter('TODOS');
    setEffectiveDateFrom('');
    setEffectiveDateTo('');
  }, [personId, personType]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 200);
    return () => clearTimeout(timer);
  }, [load]);

  useFinanceLiveRefresh(() => load(), {
    realtime: { localRefresh: true, dashboard: false, cobrancaQueries: false, portal: false },
    intervalMs: 45_000,
    minIntervalMs: 10_000,
  });

  if (loading && !hasLoadedOnceRef.current) {
    return (
      <div className="container mx-auto max-w-5xl min-w-0 overflow-x-clip px-3 py-4 sm:px-4 sm:py-6">
        <Skeleton className="mb-4 h-10 w-32 sm:mb-5" />
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-2xl" />
            ))}
          </div>
          <div className={dadosSectionClass}>
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index}>
                  <Skeleton className="mb-2 h-4 w-24" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-white p-4 sm:p-6">
            <Skeleton className="mb-4 h-6 w-48" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if ((error && !payload) || !payload) {
    return (
      <div className="container mx-auto max-w-5xl min-w-0 overflow-x-clip px-3 py-4 sm:px-4 sm:py-6">
        <button
          type="button"
          onClick={() => router.push('/financeiro/nota-fiscal')}
          className="mb-6 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:mb-8"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Voltar
        </button>
        <div className="rounded-xl border bg-white px-4 py-12 text-center sm:px-12">
          <div className="mb-4 text-4xl">⚠️</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900">Não foi possível carregar</h2>
          <p className="mb-6 text-gray-600">{error ?? 'Cliente não encontrado ou dados indisponíveis'}</p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row sm:gap-3">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => router.push('/financeiro/nota-fiscal')}>
              Voltar ao índice
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => void load()}>
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { pessoa, kpis, notas } = payload;
  const hasActiveFilters =
    statusFilter !== 'TODOS' || Boolean(effectiveDateFrom) || Boolean(effectiveDateTo);

  return (
    <div className="container mx-auto max-w-5xl min-w-0 overflow-x-clip px-3 py-4 pb-8 sm:px-4 sm:py-6">
      <div className="mb-5 sm:mb-6">
        <button
          type="button"
          onClick={() => router.push('/financeiro/nota-fiscal')}
          className="mb-4 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:mb-5"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Voltar
        </button>

        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-gray-900 md:text-2xl md:font-bold">
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm leading-snug text-gray-600">{pessoa.nome}</p>
          {pessoa.turmaNome ? (
            <p className="mt-1 text-sm leading-snug text-gray-500">{pessoa.turmaNome}</p>
          ) : null}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4 sm:mb-6">
        {[
          { label: 'Total de notas', value: String(kpis.totalNotas) },
          { label: 'Emitidas', value: String(kpis.totalEmitidas) },
          { label: 'Pendentes', value: String(kpis.pendentes) },
          { label: 'Valor emitido', value: formatCurrency(kpis.totalValor) },
        ].map((tile) => (
          <div
            key={tile.label}
            className="flex flex-col justify-center rounded-2xl bg-[#f2eeff] px-4 py-3 sm:px-6 sm:py-4"
          >
            <p className="mb-1 text-[13px] font-normal tracking-wide text-[#2D004A]">{tile.label}</p>
            <p className="text-3xl leading-none font-medium text-[#2D004A]">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className={`mb-5 sm:mb-6 ${dadosSectionClass}`}>
        <span className="text-sm font-semibold text-slate-700">{dadosSectionTitle}</span>

        <div className="grid grid-cols-3 gap-4">
          <ReadOnlyField label="Nome Completo" value={pessoa.nome} />
          <ReadOnlyField label="CPF" value={pessoa.cpfMasked ?? ''} />
          {pessoa.turmaNome ? <ReadOnlyField label="Turma" value={pessoa.turmaNome} /> : null}
        </div>

        {pessoa.responsavelPrincipal || pessoa.alunosVinculados.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {pessoa.responsavelPrincipal ? (
              <div className="space-y-1">
                <label className={dadosLabelClass}>Responsável financeiro</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={pessoa.responsavelPrincipal.nome}
                    disabled
                    readOnly
                    className={dadosInputDisabledClass}
                  />
                  <Link
                    href={`/financeiro/nota-fiscal/responsavel/${pessoa.responsavelPrincipal.id}`}
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-gray-500 transition-colors hover:border-gray-300 hover:text-brand-accent"
                    aria-label={`Ver notas fiscais de ${pessoa.responsavelPrincipal.nome}`}
                  >
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ) : null}

            {pessoa.alunosVinculados.length > 0 ? (
              <div className={pessoa.responsavelPrincipal ? undefined : 'md:col-span-2'}>
                <ReadOnlyField
                  label="Alunos vinculados"
                  value={pessoa.alunosVinculados.map((aluno) => aluno.nome).join(', ')}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-gray-900 sm:text-lg">Notas fiscais</h2>
              <p className="mt-0.5 text-xs text-gray-500">Todas as notas vinculadas a este cliente</p>
            </div>

            <NotaFiscalStatusFilters
              mode="detail"
              statusValue={statusFilter}
              onStatusChange={setStatusFilter}
              effectiveDateFrom={effectiveDateFrom}
              onEffectiveDateFromChange={setEffectiveDateFrom}
              effectiveDateTo={effectiveDateTo}
              onEffectiveDateToChange={setEffectiveDateTo}
              disabled={loading || isRefreshing}
            />
          </div>
        </div>

        <div className={isRefreshing ? 'pointer-events-none opacity-60 transition-opacity' : undefined}>
          <NotaFiscalTable
            notas={notas}
            showAlunoColumn={personType === 'RESPONSAVEL'}
            hasActiveFilters={hasActiveFilters}
            totalNotas={kpis.totalNotas}
            onActionComplete={load}
          />
        </div>
      </div>
    </div>
  );
}
