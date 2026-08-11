"use client";

import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
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
        className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex h-[219px] flex-col justify-between rounded-2xl bg-[#f2e9fc] px-5 pb-[22px] pt-4 animate-pulse alusa-dark:bg-[color:var(--color-bg-card-soft)]`}
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
      className={`${DASHBOARD_KPI_TILE_CLASSNAME} flex h-[219px] flex-col justify-between rounded-2xl bg-[#f2e9fc] px-5 pb-[22px] pt-4 alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)]`}
    >
      <div>
        <p className="text-xs font-normal text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-secondary)]">
          Turmas ativas
        </p>
        <span className="mt-5 block text-[37px] font-normal leading-none text-[#3d3a3f] alusa-dark:text-[color:var(--color-text-primary)]">
          {error ? '---' : formatCount(valor)}
        </span>
      </div>
      <Link href="/turmas" className="inline-flex h-6 w-fit items-center rounded-full bg-[#3d3a3f] px-3 text-xs font-normal text-[#f2e9fc] transition hover:bg-[#26222d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3d3a3f]/30">
        Ver turmas
      </Link>
    </div>
  );
}
