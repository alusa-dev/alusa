'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';

export type EventMetricTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function EventMetricCard({
  label,
  value,
  icon: _icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: EventMetricTone;
}) {
  void tone;

  return (
    <Card className="rounded-xl border-0 bg-brand-accent/10 p-4 text-purple-950 shadow-none">
      <div className="min-w-0">
        <p className="text-sm font-medium opacity-85">{label}</p>
        <div className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</div>
      </div>
    </Card>
  );
}
