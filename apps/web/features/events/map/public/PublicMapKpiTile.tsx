'use client';

import { DASHBOARD_KPI_TILE_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { cn } from '@/lib/utils';

function formatCount(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

export function PublicMapKpiTile({
  title,
  value,
  description,
  valueClassName,
}: {
  title: string;
  value: string;
  description: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        DASHBOARD_KPI_TILE_CLASSNAME,
        'flex flex-col rounded-xl bg-[#f4ecfd] px-3 py-2.5 alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)]',
      )}
    >
      <p className="text-[11px] font-normal tracking-wide text-[#2b2634] alusa-dark:text-[color:var(--color-text-secondary)]">
        {title}
      </p>
      <span
        className={cn(
          'mt-0.5 block text-base font-medium leading-tight text-[#2b2634] sm:text-lg alusa-dark:text-[color:var(--color-text-primary)]',
          valueClassName,
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 hidden text-[11px] leading-snug text-[#2b2634]/70 sm:block alusa-dark:text-[color:var(--color-text-muted)]">
        {description}
      </span>
    </div>
  );
}

export function formatPublicMapCount(value: number) {
  return formatCount(value);
}
