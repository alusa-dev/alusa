"use client";

import { useMemo, useState } from "react";
import { DASHBOARD_SECTION_CARD_CLASSNAME, formatCurrency } from "./utils";

const CARD_WIDTH = 700;
const CARD_HEIGHT = 260;
const DEFAULT_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type Periodo = "semanal" | "mensal" | "anual";
type Point = { x: number; y: number };

type SerieDados = {
  receita: number[];
  matriculas: number[];
  labels: string[];
};

const SERIES_MOCK: Record<Periodo, SerieDados> = {
  semanal: {
    receita: [4200, 5100, 3800, 6200, 5400, 6800, 7200],
    matriculas: [1200, 1800, 1500, 2100, 1700, 2300, 2000],
    labels: DEFAULT_DIAS,
  },
  mensal: {
    receita: [21000, 18500, 19200, 20500, 19800, 22000, 21500, 23000, 22500, 24000, 23500, 25000],
    matriculas: [8200, 9100, 8800, 9500, 9700, 10200, 9800, 10500, 11000, 10800, 11500, 12000],
    labels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
  },
  anual: {
    receita: [220000, 210000, 230000, 225000, 240000],
    matriculas: [95000, 102000, 98000, 110000, 115000],
    labels: ["2021", "2022", "2023", "2024", "2025"],
  },
};

const PERIOD_OPTIONS: { label: string; value: Periodo }[] = [
  { label: "Semanal", value: "semanal" },
  { label: "Mensal", value: "mensal" },
  { label: "Anual", value: "anual" },
];

function normalize(values: number[], maxValue: number): number[] {
  if (maxValue === 0) return values.map(() => 0);
  return values.map((value) => value / maxValue);
}

function buildPoints(values: number[], width: number, height: number, maxValue: number): Point[] {
  const normalized = normalize(values, maxValue);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return normalized.map((ratio, index) => ({
    x: stepX * index,
    // margem superior de 20% para afastar a linha do topo
    y: height * (0.2 + (1 - ratio) * 0.8),
  }));
}
function buildSmoothPath(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const pPrev = points[i - 1] ?? p0;
    const pNext = points[i + 2] ?? p1;

    const cp1x = p0.x + (p1.x - pPrev.x) / 6;
    const cp1y = p0.y + (p1.y - pPrev.y) / 6;
    const cp2x = p1.x - (pNext.x - p0.x) / 6;
    const cp2y = p1.y - (pNext.y - p0.y) / 6;

    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p1.x},${p1.y}`;
  }

  return d;
}

export function WeeklyPerformanceCard() {
  const [periodo, setPeriodo] = useState<Periodo>("semanal");
  const { receita, matriculas, labels } = SERIES_MOCK[periodo];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const {
    chartHeight,
    receitaPath,
    matriculasPath,
    matriculasAreaPath,
    pontosReceita,
    pontosMatriculas,
    valoresReceita,
    valoresMatriculas,
    dias,
  } = useMemo(() => {
    const largura = CARD_WIDTH;
    const altura = CARD_HEIGHT;
    const chartHeightValue = altura - 40;

    const receitaSegura = receita.length ? receita : SERIES_MOCK.semanal.receita;
    const matriculasSeguras = matriculas.length ? matriculas : SERIES_MOCK.semanal.matriculas;

    const maxValue = Math.max(1, ...receitaSegura, ...matriculasSeguras);
    const receitaPts = buildPoints(receitaSegura, largura, chartHeightValue, maxValue);
    const matriculasPts = buildPoints(matriculasSeguras, largura, chartHeightValue, maxValue);

    const receitaPathValue = buildSmoothPath(receitaPts);
    const matriculasPathValue = buildSmoothPath(matriculasPts);
    const areaPath = `${matriculasPathValue} L ${largura},${chartHeightValue} L 0,${chartHeightValue} Z`;

    return {
      chartHeight: chartHeightValue,
      receitaPath: receitaPathValue,
      matriculasPath: matriculasPathValue,
      matriculasAreaPath: areaPath,
      pontosReceita: receitaPts,
      pontosMatriculas: matriculasPts,
      valoresReceita: receitaSegura,
      valoresMatriculas: matriculasSeguras,
      dias: labels.length ? labels : DEFAULT_DIAS,
    };
  }, [labels, matriculas, receita]);

  return (
    <div className={`${DASHBOARD_SECTION_CARD_CLASSNAME} rounded-2xl bg-white p-6 md:p-8 pb-8`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-2xl font-medium text-gray-900">Desempenho semanal</p>
          <div className="mt-2">
            <div
              className="flex gap-1 bg-gray-100 rounded-md p-1 w-fit"
              role="group"
              aria-label="Selecionar período do desempenho"
            >
              {PERIOD_OPTIONS.map((opt) => {
                const isActive = periodo === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-label={`Filtrar desempenho por ${opt.label}`}
                    className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-brand-accent/30 focus-visible:ring-offset-0 ${isActive
                        ? "bg-white text-gray-900 border border-gray-300 shadow-sm"
                        : "bg-transparent text-gray-600 hover:bg-gray-200"
                      }`}
                    onClick={() => setPeriodo(opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm font-medium text-gray-700">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#5c2f91]" aria-hidden />
            <span className="text-[#5c2f91]">Receita</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#c4b5fd]" aria-hidden />
            Matrículas
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="relative h-[320px] w-full">
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Gráfico comparativo de receita e matrículas"
          >
            <defs>
              <linearGradient id="matriculasGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((ratio) => (
              <line
                key={ratio}
                x1={0}
                x2={CARD_WIDTH}
                y1={ratio * chartHeight}
                y2={ratio * chartHeight}
                stroke="#e5e7eb"
                strokeWidth={ratio === 0.5 ? 1 : 0.5}
                strokeDasharray="4 4"
              />
            ))}

            <path d={matriculasAreaPath} fill="url(#matriculasGradient)" stroke="none" />
            <path d={matriculasPath} fill="none" stroke="#c4b5fd" strokeWidth={2} />
            <path d={receitaPath} fill="none" stroke="#5c2f91" strokeWidth={2.8} strokeLinecap="round" />

            {pontosReceita.map((point, index) => (
              <rect
                key={index}
                x={point.x - 16}
                y={0}
                width={32}
                height={chartHeight}
                fill="transparent"
                pointerEvents="all"
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            ))}

            {hoverIndex !== null && pontosReceita[hoverIndex] && (
              <g>
                <circle cx={pontosReceita[hoverIndex].x} cy={pontosReceita[hoverIndex].y} r={5} fill="#5c2f91" />
                {(() => {
                  const rawX = pontosReceita[hoverIndex].x;
                  const rawY = pontosReceita[hoverIndex].y;

                  const tooltipWidth = 90;
                  const tooltipHeight = 24;
                  const marginTop = 8;
                  const marginSide = 8;

                  const x = Math.min(
                    Math.max(rawX - tooltipWidth / 2, marginSide),
                    CARD_WIDTH - tooltipWidth - marginSide,
                  );

                  const y = Math.max(marginTop, rawY - (tooltipHeight + 8));

                  return (
                    <>
                      <rect x={x} y={y} width={tooltipWidth} height={tooltipHeight} rx={12} fill="#5c2f91" />
                      <text
                        x={x + tooltipWidth / 2}
                        y={y + tooltipHeight / 2 + 1}
                        textAnchor="middle"
                        fontSize="10"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontWeight="400"
                        fill="white"
                        alignmentBaseline="middle"
                        dominantBaseline="middle"
                      >
                        {`R$ ${formatCurrency(valoresReceita[hoverIndex])}`}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}

            {hoverIndex !== null && pontosMatriculas[hoverIndex] && (
              <g>
                <circle
                  cx={pontosMatriculas[hoverIndex].x}
                  cy={pontosMatriculas[hoverIndex].y}
                  r={4}
                  fill="#c4b5fd"
                />
                {(() => {
                  const rawX = pontosMatriculas[hoverIndex].x;
                  const rawY = pontosMatriculas[hoverIndex].y;

                  const tooltipWidth = 90;
                  const tooltipHeight = 22;
                  const marginSide = 8;

                  const x = Math.min(
                    Math.max(rawX - tooltipWidth / 2, marginSide),
                    CARD_WIDTH - tooltipWidth - marginSide,
                  );

                  const y = rawY + 10;

                  return (
                    <>
                      <rect x={x} y={y} width={tooltipWidth} height={tooltipHeight} rx={11} fill="#c4b5fd" />
                      <text
                        x={x + tooltipWidth / 2}
                        y={y + tooltipHeight / 2 + 1}
                        textAnchor="middle"
                        fontSize="10"
                        fontFamily="Inter, system-ui, sans-serif"
                        fontWeight="400"
                        fill="#1f2933"
                        alignmentBaseline="middle"
                        dominantBaseline="middle"
                      >
                        {`${valoresMatriculas[hoverIndex]} matrículas`}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}
          </svg>

          <div className="-mt-4 flex items-center justify-between text-xs font-medium text-gray-500">
            {dias.map((dia) => (
              <span key={dia}>{dia}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
