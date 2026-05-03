"use client";

import { useEffect, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import useCurrentUser from '@/hooks/use-current-user';
import { formatCurrency } from "./utils";

export type PeriodoTaxaMatricula = "15d" | "30d" | "1a";

type TaxaMatriculaData = {
  totalTaxas: number;
  variacaoPercentual: number | null;
  serie: number[];
  serieAcumulada: number[];
};

const TAXA_CACHE_TTL_MS = 30_000;
const taxaMatriculaCache = new Map<
  string,
  { expiresAt: number; promise: Promise<TaxaMatriculaData | null> }
>();

// Hook para buscar taxas de matrícula
function useTaxaMatricula(periodo: PeriodoTaxaMatricula | null) {
  const { user } = useCurrentUser();
  const contaId = user?.contaId;
  const [data, setData] = useState<TaxaMatriculaData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTaxas = useCallback(async () => {
    if (!contaId) return;

    setLoading(true);
    try {
      const periodoParam = periodo || '30d';
      const cacheKey = `${contaId}:${periodoParam}`;
      const cached = taxaMatriculaCache.get(cacheKey);
      const promise =
        cached && cached.expiresAt > Date.now()
          ? cached.promise
          : fetch(`/api/dashboard/taxa-matricula?contaId=${contaId}&periodo=${periodoParam}`, {
              headers: { Accept: 'application/json' },
            })
              .then(async (response) => {
                const result = await response.json();
                return result.success ? (result.data as TaxaMatriculaData) : null;
              })
              .catch((error) => {
                taxaMatriculaCache.delete(cacheKey);
                throw error;
              });

      taxaMatriculaCache.set(cacheKey, {
        expiresAt: Date.now() + TAXA_CACHE_TTL_MS,
        promise,
      });

      const result = await promise;
      if (result) setData(result);
    } catch (error) {
      console.error('Erro ao buscar taxas de matrícula:', error);
    } finally {
      setLoading(false);
    }
  }, [contaId, periodo]);

  useEffect(() => {
    fetchTaxas();
  }, [fetchTaxas]);

  return { data, loading };
}

type TaxaMatriculaCardProps = {
  periodo: PeriodoTaxaMatricula;
  onPeriodoChange?: (_periodo: PeriodoTaxaMatricula | null) => void;
};

function TaxaMatriculaToggle({
  periodo,
  onPeriodoChange,
}: {
  periodo: PeriodoTaxaMatricula | null;
  onPeriodoChange?: (_periodo: PeriodoTaxaMatricula | null) => void;
}) {
  const options: { label: string; value: PeriodoTaxaMatricula }[] = [
    { label: "1A", value: "1a" },
    { label: "30D", value: "30d" },
    { label: "15D", value: "15d" },
  ];

  return (
    <div
      className="relative inline-flex w-fit items-center rounded-full bg-[#eadcf8] p-1"
      role="group"
      aria-label="Selecionar período da taxa de matrícula"
    >
      {options.map((opt) => {
        const isActive = periodo === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isActive}
            aria-label={`Filtrar por ${opt.label}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-brand-accent ${
              isActive ? "bg-[#f8f3fd] text-[#2b2634] shadow-sm" : "text-[#4c4459] hover:text-[#2b2634]"
            }`}
            onClick={() => onPeriodoChange?.(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function TaxaMatriculaCard({
  periodo,
  onPeriodoChange,
}: TaxaMatriculaCardProps) {
  const { data, loading } = useTaxaMatricula(periodo);

  const valorPago = data?.totalTaxas ?? 0;

  if (loading) {
    return (
      <div className="flex h-full min-h-[220px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 animate-pulse">
        <div>
          <div>
            <Skeleton className="mb-2 h-4 w-28 bg-[#e9dffc]" />
            <Skeleton className="h-10 w-32 bg-[#e9dffc]" />
          </div>
        </div>
        <div className="mt-3 flex items-end">
          <Skeleton className="h-8 w-36 rounded-full bg-[#e9dffc]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[220px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
      <div>
        <div>
          <p className="text-[13px] font-normal tracking-wide text-[#2b2634] mb-2 text-left">
            Taxa de matrícula
          </p>
          <span className="text-4xl leading-none font-medium text-[#2b2634] mb-1 block">
            {formatCurrency(valorPago)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-end">
          <TaxaMatriculaToggle periodo={periodo} onPeriodoChange={onPeriodoChange} />
      </div>
    </div>
  );
}
