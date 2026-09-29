'use client';

import * as React from 'react';
import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { FinancialReportBreakdownItem, FinancialReportSeriesItem } from '../dtos';
import { formatReportMoney } from '../utils/formatters';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 240;
const CHART_MARGIN = { top: 14, right: 16, bottom: 38, left: 64 };

function niceAxisMaximum(maximum: number): number {
  if (maximum <= 0) return 1;
  const roughStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = factor * magnitude;
  return Math.ceil(maximum / step) * step;
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function FinancialTrendChart({
  title,
  description,
  data,
  loading,
  mode = 'overview',
}: {
  title: string;
  description: string;
  data: FinancialReportSeriesItem[];
  loading?: boolean;
  mode?: 'overview' | 'receipts';
}): React.JSX.Element {
  const maximum = Math.max(
    1,
    ...data.flatMap((item) =>
      mode === 'overview' ? [item.charged, item.received] : [item.received, item.net],
    ),
  );
  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} min-w-0 rounded-2xl bg-white p-5 shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby={`${title}-heading`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id={`${title}-heading`}
            className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]"
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            {description}
          </p>
        </div>
        {mode === 'overview' ? (
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#cfc4df]" /> Total em cobranças
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-brand-accent" /> Recebido
            </span>
          </div>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-6 h-52 w-full" />
      ) : data.length === 0 ? (
        <p className="grid h-52 place-items-center text-sm text-gray-500">
          Sem dados para o período.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          {mode === 'overview' ? (
            <OverviewGroupedBarChart data={data} title={title} description={description} />
          ) : (
            <div className="min-w-[460px]">
              <div
                className="flex items-end gap-4"
                role="img"
                aria-label={`${title}. ${description}`}
              >
                {data.map((item) => (
                  <div key={item.key} className="flex min-w-16 flex-1 flex-col items-center gap-2">
                    <div className="flex h-36 w-full items-end justify-center gap-1.5 border-b border-slate-200 alusa-dark:border-[color:var(--color-border-default)]">
                      <div
                        className="w-4 rounded-t bg-brand-accent/25"
                        style={{ height: `${Math.max(2, (item.received / maximum) * 100)}%` }}
                        title={`Bruto: ${formatReportMoney(item.received)}`}
                      />
                      <div
                        className="w-4 rounded-t bg-brand-accent"
                        style={{ height: `${Math.max(2, (item.net / maximum) * 100)}%` }}
                        title={`Líquido: ${formatReportMoney(item.net)}`}
                      />
                    </div>
                    <span className="text-[11px] font-medium capitalize text-gray-500">
                      {item.label.replace('.', '')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-center gap-5 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-brand-accent/25" /> Valor bruto
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-brand-accent" /> Valor líquido
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function OverviewGroupedBarChart({
  data,
  title,
  description,
}: {
  data: FinancialReportSeriesItem[];
  title: string;
  description: string;
}) {
  const rawMaximum = Math.max(1, ...data.flatMap((item) => [item.charged, item.received]));
  const axisMaximum = niceAxisMaximum(rawMaximum);
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const categoryWidth = plotWidth / data.length;
  const groupWidth = Math.min(42, categoryWidth * 0.66);
  const barGap = 4;
  const barWidth = Math.max(5, (groupWidth - barGap) / 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const heightFor = (value: number) => (value / axisMaximum) * plotHeight;

  return (
    <div className="min-w-[620px]">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-60 w-full"
        role="img"
        aria-label={`${title}. ${description}`}
      >
        {ticks.map((ratio) => {
          const y = CHART_MARGIN.top + plotHeight - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line
                x1={CHART_MARGIN.left}
                x2={CHART_WIDTH - CHART_MARGIN.right}
                y1={y}
                y2={y}
                className="stroke-slate-100 alusa-dark:stroke-[color:var(--color-border-subtle)]"
              />
              <text
                x={CHART_MARGIN.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px]"
              >
                {compactMoney(axisMaximum * ratio)}
              </text>
            </g>
          );
        })}
        {data.map((item, index) => {
          const center = CHART_MARGIN.left + categoryWidth * (index + 0.5);
          const chargedHeight = heightFor(item.charged);
          const receivedHeight = heightFor(item.received);
          return (
            <g key={item.key}>
              <rect
                x={center - barGap / 2 - barWidth}
                y={CHART_MARGIN.top + plotHeight - chargedHeight}
                width={barWidth}
                height={chargedHeight}
                rx="3"
                fill="#cfc4df"
              >
                <title>{`Total em cobranças: ${formatReportMoney(item.charged)}`}</title>
              </rect>
              <rect
                x={center + barGap / 2}
                y={CHART_MARGIN.top + plotHeight - receivedHeight}
                width={barWidth}
                height={receivedHeight}
                rx="3"
                fill="#5b2d91"
              >
                <title>{`Recebido: ${formatReportMoney(item.received)}`}</title>
              </rect>
              <text
                x={center}
                y={CHART_HEIGHT - 12}
                textAnchor="middle"
                className="fill-slate-500 text-[10px] capitalize"
              >
                {item.label.replace('. de ', '/')}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Total em cobranças e recebido por mês</caption>
        <thead>
          <tr>
            <th>Mês</th>
            <th>Total em cobranças</th>
            <th>Recebido</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr key={item.key}>
              <td>{item.label}</td>
              <td>{formatReportMoney(item.charged)}</td>
              <td>{formatReportMoney(item.received)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FinancialDistributionChart({
  title,
  description,
  data,
  loading,
}: {
  title: string;
  description: string;
  data: FinancialReportBreakdownItem[];
  loading?: boolean;
}): React.JSX.Element {
  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} min-w-0 rounded-2xl bg-white p-5 alusa-dark:bg-[color:var(--color-bg-card)]`}
    >
      <h2 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
        {title}
      </h2>
      <p className="mt-1 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
        {description}
      </p>
      {loading ? (
        <div className="mt-6 space-y-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-8 w-full" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <p className="grid h-52 place-items-center text-sm text-gray-500">
          Sem dados para o período.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {data.slice(0, 6).map((item) => (
            <div key={item.key}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="truncate font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-primary)]">
                  {item.label}
                </span>
                <span className="shrink-0 tabular-nums text-gray-500">
                  {formatReportMoney(item.amount)} · {item.percentage}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                <div
                  className="h-full rounded-full bg-brand-accent"
                  style={{ width: `${Math.max(2, item.percentage)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
