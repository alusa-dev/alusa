"use client";

import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

import { DASHBOARD_KPI_TILE_CLASSNAME } from './utils';

type RecebidasKpiCardProps = {
  data: DashboardMetricsDataDTO | null;
  loading: boolean;
  error?: string | null;
};

function formatCount(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function RecebidasKpiCard({ data, loading, error = null }: RecebidasKpiCardProps) {

  if (loading && !data) {
    return (
      <div
        className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex h-full min-h-[220px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 animate-pulse alusa-dark:bg-[color:var(--color-bg-card-soft)]`}
      >
        <div>
          <Skeleton className="mb-2 h-4 w-24 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
          <Skeleton className="h-10 w-32 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
        </div>
      </div>
    );
  }

  const valor = data?.turmasAtivas ?? 0;

  return (
    <div
      className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex h-full min-h-[220px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)]`}
    >
      <div>
        <p className="mb-2 text-[13px] font-normal tracking-wide text-[#2b2634] alusa-dark:text-[color:var(--color-text-secondary)]">
          Turmas ativas
        </p>
        <span className="mb-1 block text-4xl font-medium leading-none text-[#2b2634] alusa-dark:text-[color:var(--color-text-primary)]">
          {error ? '---' : formatCount(valor)}
        </span>
        <span className="text-xs text-[#2b2634]/70 alusa-dark:text-[color:var(--color-text-muted)]">
          Com status ativo
        </span>
      </div>
    </div>
  );
}
