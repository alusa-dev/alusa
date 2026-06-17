'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import TableLayout from '@/components/layout/TableLayout';
import Pagination from '@/components/layout/Pagination';
import { InfoCallout, InfoCalloutLink } from '@/components/ui/info-callout';
import { pushToast } from '@/components/ui/toast';
import { NotaFiscalStatusFilters } from '@/features/financeiro/notafiscal/components/NotaFiscalStatusFilters';
import { PessoaNotaFiscalCard } from '@/features/financeiro/notafiscal/components/PessoaNotaFiscalCard';
import { PessoaNotaFiscalCardSkeleton } from '@/features/financeiro/notafiscal/components/PessoaNotaFiscalCardSkeleton';
import type { ListNotaFiscalPersonIndexResultDTO } from '@/features/financeiro/notafiscal/dtos';
import { resolveNotaFiscalPersonHref } from '@/features/financeiro/notafiscal/mappers';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';

const PAGE_SIZE = 20;

export function NotaFiscalIndexFeature() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pessoas, setPessoas] = useState<ListNotaFiscalPersonIndexResultDTO['data']>([]);
  const [readiness, setReadiness] = useState<ListNotaFiscalPersonIndexResultDTO['readiness'] | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [effectiveDateFrom, setEffectiveDateFrom] = useState('');
  const [effectiveDateTo, setEffectiveDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (statusFilter !== 'TODOS') params.append('status', statusFilter);
      if (effectiveDateFrom) params.set('effectiveDateFrom', effectiveDateFrom);
      if (effectiveDateTo) params.set('effectiveDateTo', effectiveDateTo);

      const res = await fetch(`/api/financeiro/nota-fiscal/summary?${params.toString()}`, {
        cache: 'no-store',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        pushToast({
          title: 'Erro',
          description: data?.error?.message || 'Falha ao carregar notas fiscais',
          variant: 'error',
        });
        setPessoas([]);
        setTotal(0);
        return;
      }

      const payload = (await res.json()) as ListNotaFiscalPersonIndexResultDTO;
      setPessoas(payload.data || []);
      setTotal(payload.total || 0);
      setReadiness(payload.readiness ?? null);
    } catch (error) {
      pushToast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'error',
      });
      setPessoas([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, statusFilter, effectiveDateFrom, effectiveDateTo]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadData]);

  useFinanceLiveRefresh(() => loadData(), {
    realtime: { localRefresh: true, dashboard: false, cobrancaQueries: false, portal: false },
    intervalMs: 45_000,
    minIntervalMs: 10_000,
  });

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, effectiveDateFrom, effectiveDateTo]);

  const filterProps = {
    searchValue: searchQuery,
    onSearchChange: setSearchQuery,
    statusValue: statusFilter,
    onStatusChange: setStatusFilter,
    effectiveDateFrom,
    onEffectiveDateFromChange: setEffectiveDateFrom,
    effectiveDateTo,
    onEffectiveDateToChange: setEffectiveDateTo,
    disabled: loading,
  };

  return (
    <TableLayout
      title="Nota Fiscal"
      subtitle="Histórico de notas fiscais por cliente. Toque em uma pessoa para ver o detalhamento."
      actions={<NotaFiscalStatusFilters mode="search" {...filterProps} />}
      filtersBar={<NotaFiscalStatusFilters mode="filters" {...filterProps} />}
    >
      {!loading && readiness && !readiness.ready ? (
        <InfoCallout variant="warning" className="mb-4">
          <p className="font-medium">Configuração fiscal incompleta</p>
          <p className="mt-1 text-sm">
            {readiness.issues[0]?.message ??
              'Conclua a configuração para emitir novas notas. As notas já registradas continuam visíveis aqui.'}
          </p>
          <InfoCalloutLink href="/admin/configuracoes/notafiscal" className="mt-2 inline-block">
            Ir para configuração fiscal
          </InfoCalloutLink>
        </InfoCallout>
      ) : null}

      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <PessoaNotaFiscalCardSkeleton key={index} />
            ))}
          </div>
        ) : null}

        {!loading && pessoas.length === 0 ? (
          <div className="rounded-xl border bg-white px-6 py-12 text-center text-sm text-gray-500">
            Nenhuma nota fiscal registrada.
          </div>
        ) : null}

        {!loading && pessoas.length > 0 ? (
          <div className="space-y-3">
            {pessoas.map((pessoa) => (
              <PessoaNotaFiscalCard
                key={`${pessoa.tipo}:${pessoa.id}`}
                pessoa={pessoa}
                onClick={() => router.push(resolveNotaFiscalPersonHref(pessoa))}
              />
            ))}
          </div>
        ) : null}
      </div>

      {!loading && total > PAGE_SIZE ? (
        <div className="mt-6">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={setPage}
          />
        </div>
      ) : null}
    </TableLayout>
  );
}
