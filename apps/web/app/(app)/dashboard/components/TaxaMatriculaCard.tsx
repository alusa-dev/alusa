"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
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
      const response = await fetch(`/api/dashboard/taxa-matricula?contaId=${contaId}&periodo=${periodoParam}`);
      const result = await response.json();

      if (result.success) {
        setData(result.data);
      }
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

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<PeriodoTaxaMatricula, HTMLButtonElement>>(new Map());
  const initialized = useRef(false);

  const indicatorLeft = useMotionValue(0);
  const indicatorWidth = useMotionValue(0);

  const moveIndicator = useCallback((value: PeriodoTaxaMatricula, instant = false) => {
    const btn = buttonRefs.current.get(value);
    const container = containerRef.current;
    if (!btn || !container) return;

    // offsetLeft relativo ao container (desconta padding de 4px do p-1)
    const left = btn.offsetLeft;
    const width = btn.offsetWidth;

    if (instant) {
      indicatorLeft.set(left);
      indicatorWidth.set(width);
    } else {
      animate(indicatorLeft, left, {
        type: "spring",
        stiffness: 300,
        damping: 30,
        mass: 0.8,
      });
      animate(indicatorWidth, width, {
        type: "spring",
        stiffness: 400,
        damping: 35,
        mass: 0.6,
      });
    }
  }, [indicatorLeft, indicatorWidth]);

  // Inicialização: posiciona sem animação
  useEffect(() => {
    const active = periodo ?? "30d";
    if (initialized.current) return;
    // Aguarda o layout do DOM
    const frame = requestAnimationFrame(() => {
      moveIndicator(active, true);
      initialized.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [periodo, moveIndicator]);

  // Quando periodo muda (após inicializado), anima
  useEffect(() => {
    if (!initialized.current) return;
    const active = periodo ?? "30d";
    moveIndicator(active, false);
  }, [periodo, moveIndicator]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex w-fit items-center rounded-full bg-[#eadcf8] p-1"
      role="group"
      aria-label="Selecionar período da taxa de matrícula"
    >
      {/* Indicador deslizante — posicionado absolutamente no container */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-[#f8f3fd] shadow-sm"
        style={{ left: indicatorLeft, width: indicatorWidth }}
      />

      {options.map((opt) => {
        const isActive = periodo === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              if (el) buttonRefs.current.set(opt.value, el);
            }}
            type="button"
            aria-pressed={isActive}
            aria-label={`Filtrar por ${opt.label}`}
            className={`relative z-10 rounded-full px-3 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-accent transition-colors duration-150 ${
              isActive ? "text-[#2b2634]" : "text-[#2b2634]/60 hover:text-[#2b2634]"
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
