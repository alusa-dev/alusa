'use client';

import * as React from 'react';

import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { FinancialEnrollmentSeriesItem } from '../dtos';

const WIDTH = 760;
const HEIGHT = 240;
const PADDING = { top: 18, right: 18, bottom: 38, left: 38 };

type Point = { x: number; y: number };

function smoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`;
  }, '');
}

export function EnrollmentCancellationChart({
  data,
  loading,
}: {
  data: FinancialEnrollmentSeriesItem[];
  loading?: boolean;
}): React.JSX.Element {
  const maximum = Math.max(1, ...data.flatMap((item) => [item.enrollments, item.cancellations]));
  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (index: number) =>
    data.length === 1
      ? PADDING.left + chartWidth / 2
      : PADDING.left + (index / (data.length - 1)) * chartWidth;
  const yFor = (value: number) => PADDING.top + chartHeight - (value / maximum) * chartHeight;
  const enrollmentPoints = data.map((item, index) => ({
    x: xFor(index),
    y: yFor(item.enrollments),
  }));
  const cancellationPoints = data.map((item, index) => ({
    x: xFor(index),
    y: yFor(item.cancellations),
  }));
  const hasData = data.some((item) => item.enrollments > 0 || item.cancellations > 0);
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: Math.round(maximum * ratio),
    y: PADDING.top + chartHeight - chartHeight * ratio,
  }));

  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} min-w-0 rounded-2xl bg-white p-5 shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby="enrollment-cancellation-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="enrollment-cancellation-title"
            className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]"
          >
            Matrículas × Cancelamentos
          </h3>
          <p className="mt-1 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            Evolução mensal de matrículas e cancelamentos no ano atual.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-violet-600" /> Matrículas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Cancelamentos
          </span>
        </div>
      </div>

      {loading ? (
        <Skeleton className="mt-6 h-60 w-full" />
      ) : !hasData ? (
        <p className="grid h-60 place-items-center text-sm text-gray-500">
          Sem movimentações de matrícula no ano atual.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <svg
            className="h-60 min-w-[620px] w-full"
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="Gráfico em curvas comparando matrículas e cancelamentos por mês"
          >
            {gridValues.map(({ ratio, value, y }) => (
              <g key={ratio}>
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  className="stroke-slate-100 alusa-dark:stroke-[color:var(--color-border-subtle)]"
                />
                <text
                  x={PADDING.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px]"
                >
                  {value}
                </text>
              </g>
            ))}
            <path
              d={smoothPath(enrollmentPoints)}
              fill="none"
              stroke="#7c3aed"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d={smoothPath(cancellationPoints)}
              fill="none"
              stroke="#f43f5e"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {data.map((item, index) => (
              <g key={item.key}>
                <circle
                  cx={enrollmentPoints[index].x}
                  cy={enrollmentPoints[index].y}
                  r="4"
                  fill="white"
                  stroke="#7c3aed"
                  strokeWidth="2.5"
                >
                  <title>{`${item.label}: ${item.enrollments} matrículas`}</title>
                </circle>
                <circle
                  cx={cancellationPoints[index].x}
                  cy={cancellationPoints[index].y}
                  r="4"
                  fill="white"
                  stroke="#f43f5e"
                  strokeWidth="2.5"
                >
                  <title>{`${item.label}: ${item.cancellations} cancelamentos`}</title>
                </circle>
                <text
                  x={xFor(index)}
                  y={HEIGHT - 12}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] capitalize"
                >
                  {item.label.replace('.', '')}
                </text>
              </g>
            ))}
          </svg>
          <table className="sr-only">
            <caption>Matrículas e cancelamentos por mês</caption>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Matrículas</th>
                <th>Cancelamentos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.key}>
                  <td>{item.label}</td>
                  <td>{item.enrollments}</td>
                  <td>{item.cancellations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
