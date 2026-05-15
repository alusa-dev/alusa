import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export function SupportPageHeader({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
}) {
  return (
    <div className="mb-6">
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</p>
      ) : null}
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      {description ? <p className="mt-2 max-w-3xl text-sm text-slate-600">{description}</p> : null}
    </div>
  );
}

export function SupportPanel({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white', className)}>
      {title || description ? (
        <div className="border-b border-slate-200 px-5 py-4">
          {title ? <h3 className="text-sm font-semibold text-slate-950">{title}</h3> : null}
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function SupportMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = {
    default: 'text-slate-950',
    warning: 'text-amber-700',
    danger: 'text-rose-700',
    success: 'text-emerald-700',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold', toneClass)}>{value}</p>
    </div>
  );
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-5 py-8 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <Badge variant="neutral">Sem status</Badge>;
  return (
    <Badge
      variant={value.includes('ERROR') || value.includes('FAILED') ? 'destructive' : 'outline'}
    >
      {value}
    </Badge>
  );
}

export function RowLink({
  href,
  title,
  description,
  meta,
}: {
  href: string;
  title: string;
  description?: string;
  meta?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3 hover:border-slate-300 hover:bg-slate-50"
    >
      <span>
        <span className="block text-sm font-medium text-slate-950">{title}</span>
        {description ? (
          <span className="mt-1 block text-sm text-slate-500">{description}</span>
        ) : null}
        {meta ? <span className="mt-2 flex flex-wrap gap-2">{meta}</span> : null}
      </span>
      <Icon name="ChevronRight" className="shrink-0 text-slate-400" />
    </Link>
  );
}
