'use client';

import * as React from 'react';
import { Help } from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DASHBOARD_KPI_TILE_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { formatReportMoney } from '../utils/formatters';

export function FinancialMetricCard({
  label,
  value,
  description,
  loading,
  onClick,
  format = 'money',
}: {
  label: string;
  value: number;
  description: string;
  loading?: boolean;
  onClick?: () => void;
  format?: 'money' | 'number' | 'percent' | 'days';
}): React.JSX.Element {
  const content =
    format === 'money'
      ? formatReportMoney(value)
      : format === 'percent'
        ? `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
        : format === 'days'
          ? `${Math.round(value)} dias`
          : value.toLocaleString('pt-BR');
  const Component = onClick ? 'button' : 'div';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        DASHBOARD_KPI_TILE_CLASSNAME,
        'flex min-h-[132px] min-w-0 flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 text-left alusa-dark:bg-[linear-gradient(165deg,var(--color-card-bg-purple)_0%,var(--color-bg-card-soft)_55%)]',
        onClick &&
          'transition-colors hover:bg-[#efe3fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30 alusa-dark:hover:bg-[color:var(--color-bg-card-soft)]',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-normal tracking-wide text-[#2b2634] alusa-dark:text-[color:var(--color-text-secondary)]">
          {label}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                aria-label={`Como calculamos ${label}`}
                className="inline-flex rounded-full text-[#2b2634]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30"
              >
                <Help className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{description}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {loading ? (
        <Skeleton className="h-9 w-36 bg-[#e9dffc] alusa-dark:bg-[color:var(--color-border-strong)]/40" />
      ) : (
        <p className="truncate text-[26px] font-medium leading-none tracking-tight text-[#2b2634] tabular-nums alusa-dark:text-[color:var(--color-text-primary)]">
          {content}
        </p>
      )}
    </Component>
  );
}
