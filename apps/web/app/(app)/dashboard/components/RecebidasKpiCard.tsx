"use client";

import { Skeleton } from '@/components/ui/skeleton';
import type { DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

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
      <div className="flex flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full animate-pulse">
        <div>
          <Skeleton className="h-4 w-24 bg-[#e9dffc] mb-2" />
          <Skeleton className="h-10 w-32 bg-[#e9dffc]" />
        </div>
      </div>
    );
  }

  const valor = data?.turmasAtivas ?? 0;

  return (
    <div className="flex flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full">
      <div>
        <p className="text-[13px] font-normal tracking-wide text-[#2b2634] mb-2">
          Turmas ativas
        </p>
        <span className="text-4xl leading-none font-medium text-[#2b2634] mb-1 block">
          {error ? '---' : formatCount(valor)}
        </span>
        <span className="text-xs text-[#2b2634]/70">
          Com status ativo
        </span>
      </div>
    </div>
  );
}
