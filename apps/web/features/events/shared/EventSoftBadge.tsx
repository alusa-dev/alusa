'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type EventSoftBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function EventSoftBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: EventSoftBadgeTone }) {
  const className = {
    neutral: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-rose-100 text-rose-800',
    info: 'bg-violet-100 text-violet-800',
  }[tone];
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>{children}</span>;
}
