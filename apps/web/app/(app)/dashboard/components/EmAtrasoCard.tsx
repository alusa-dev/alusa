"use client";

import { useState } from "react";
import { buildSparklinePath } from "./utils";

type EmAtrasoCardProps = {
  quantidadeEmAtraso: number;
  taxaInadimplencia?: number;
  serie?: number[];
};

type PeriodoEmAtraso = "7d" | "30d" | "1a";

function EmAtrasoToggle({
  periodo,
  onPeriodoChange,
}: {
  periodo: PeriodoEmAtraso | null;
  onPeriodoChange?: (_periodo: PeriodoEmAtraso | null) => void;
}) {
  const options: { label: string; value: PeriodoEmAtraso }[] = [
    { label: "7D", value: "7d" },
    { label: "30D", value: "30d" },
    { label: "1A", value: "1a" },
  ];

  return (
    <div
      className="flex gap-1 bg-[#e9dffc] rounded-md p-1 w-fit"
      role="group"
      aria-label="Selecionar período de cobranças em atraso"
    >
      {options.map((opt) => {
        const isActive = periodo === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-label={`Filtrar cobranças em atraso por ${opt.label}`}
            className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-0
              ${isActive
                ? 'bg-[#f4ecfd] text-[#2b2634]'
                : 'bg-transparent text-[#2b2634]/70 hover:bg-[#f4ecfd]/50'}
            `}
            onClick={() => onPeriodoChange?.(isActive ? null : opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function EmAtrasoChart({ serie }: { serie: number[] }) {
  const width = 260;
  const height = 90;

  const spark = buildSparklinePath(serie, width, height);
  if (!spark.d) return null;

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Gráfico de cobranças em atraso"
      role="img"
      className="max-w-[260px] w-full block"
    >
      <defs>
        <linearGradient id="emAtrasoGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5c2f91" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#5c2f91" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${spark.d} L ${width},${height} L 0,${height} Z`}
        fill="url(#emAtrasoGradient)"
        stroke="none"
      />
      <path d={spark.d} fill="none" stroke="#5c2f91" strokeWidth={2} strokeLinecap="round" />
      {spark.lastPoint && (
        <circle cx={spark.lastPoint.x} cy={spark.lastPoint.y} r={3} fill="#5c2f91" />
      )}
    </svg>
  );
}

export function EmAtrasoCard({ quantidadeEmAtraso, taxaInadimplencia = 0, serie }: EmAtrasoCardProps) {
  const [periodo, setPeriodo] = useState<PeriodoEmAtraso | null>(null);

  const fallbackPorPeriodo: Record<PeriodoEmAtraso, number[]> = {
    "7d": [0, 1, 1, 2, 1, 2, 3],
    "30d": [0, 1, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5],
    "1a": [1, 2, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6],
  };

  const baseFallback = periodo ? fallbackPorPeriodo[periodo] : fallbackPorPeriodo["30d"];

  const baseSerie =
    Array.isArray(serie) && serie.length > 1 && new Set(serie).size > 1 ? serie : baseFallback;

  return (
    <div className="flex flex-col md:flex-row items-stretch justify-between gap-4 rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[140px]">
      <div className="flex flex-col justify-between min-w-[120px] md:max-w-[180px] flex-shrink-0 h-full">
        <div>
          <p className="text-[13px] font-normal tracking-wide text-[#2b2634] mb-2 text-left">
            Em atraso
          </p>
          <span className="text-4xl leading-none font-semibold text-[#2b2634] mb-1 block">
            {quantidadeEmAtraso}
          </span>
          <span className="text-[11px] leading-snug text-[#2b2634]/70">
            {taxaInadimplencia.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de inadimplência
          </span>
        </div>
        <div className="flex items-end mt-3">
          <EmAtrasoToggle periodo={periodo} onPeriodoChange={setPeriodo} />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center mt-3 md:mt-0">
        <div className="w-full h-[96px] flex items-center justify-center">
          <EmAtrasoChart serie={baseSerie} />
        </div>
      </div>
    </div>
  );
}
