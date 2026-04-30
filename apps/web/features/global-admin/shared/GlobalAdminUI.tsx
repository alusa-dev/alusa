import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

type Tone = 'default' | 'warning' | 'critical' | 'success';

export function GlobalAdminPageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-0.5">
        {eyebrow ? (
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-slate-500">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-0.5">
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900 md:text-[24px]">{title}</h1>
          <p className="max-w-3xl text-[13px] leading-5 text-slate-600">{description}</p>
        </div>
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </section>
  );
}

export function GlobalAdminMetricCard({
  label,
  value,
  description,
  tone = 'default',
  href,
}: {
  label: string;
  value: React.ReactNode;
  description: string;
  tone?: Tone;
  href?: string;
}) {
  const content = (
    <div
      className={cn(
        'flex min-h-[112px] flex-col justify-between rounded-xl px-5 py-4 transition-colors',
        tone === 'critical' && 'bg-[#FFF0EB]',
        tone === 'warning' && 'bg-[#FFF8E6]',
        tone === 'success' && 'bg-[#EAF8F0]',
        tone === 'default' && 'bg-[#F4ECFD]',
        href && 'hover:opacity-95',
      )}
    >
      <div className="space-y-2.5">
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-[#2B2634]/80">{label}</p>
          <p className="text-[26px] font-semibold leading-none tracking-tight text-[#16121D] md:text-[30px]">
            {value}
          </p>
        </div>
        <p className="text-[12px] leading-5 text-[#2B2634]/65">{description}</p>
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <Link className="block" href={href}>
      {content}
    </Link>
  );
}

export function GlobalAdminPanel({
  title,
  description,
  aside,
  children,
  className,
}: {
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6',
        className,
      )}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-0.5">
          <h2 className="text-[18px] font-semibold tracking-tight text-gray-900">{title}</h2>
          {description ? <p className="text-[13px] leading-5 text-slate-600">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function GlobalAdminSeverityBadge({
  severity,
  children,
}: {
  severity: 'info' | 'warning' | 'critical' | 'success';
  children: React.ReactNode;
}) {
  const variant =
    severity === 'critical'
      ? 'destructive'
      : severity === 'warning'
        ? 'warning'
        : severity === 'success'
          ? 'success'
          : 'neutral';

  return (
    <Badge variant={variant} className={cn('text-xs font-medium')}>
      {children}
    </Badge>
  );
}

export function GlobalAdminEmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

export function GlobalAdminLinkTabs({
  items,
}: {
  items: Array<{ href: string; label: string; active?: boolean }>;
}) {
  return (
    <div className="inline-flex h-9 items-center rounded-xl bg-slate-200/50 p-1 text-slate-500">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-1.5 text-xs font-medium transition-all',
            item.active
              ? 'bg-white text-slate-950 shadow-sm'
              : 'text-slate-500 hover:text-slate-900',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
