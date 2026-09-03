import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/icons/Icon';
import { cn } from '@/lib/cn';
import { formatSupportStatus } from './format';

export function SupportPageHeader({ title, description }: { title: string; description?: string }) {
  return <div className="support-page-header"><h2>{title}</h2>{description ? <p className="support-page-description">{description}</p> : null}</div>;
}

export function SupportPanel({ title, description, actions, children, className, bodyClassName }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return <section className={cn('support-panel', className)}>{title || description || actions ? <div className="support-panel-header"><div className="support-panel-header-copy">{title ? <h3>{title}</h3> : null}{description ? <p>{description}</p> : null}</div>{actions ? <div className="support-panel-header-actions">{actions}</div> : null}</div> : null}<div className={cn('support-panel-body', bodyClassName)}>{children}</div></section>;
}

export function SupportMetric({ label, value, tone = 'default', emphasis = false }: { label: string; value: ReactNode; tone?: 'default' | 'warning' | 'danger' | 'success'; emphasis?: boolean }) {
  return <div className={cn('support-metric', `support-metric-${tone}`, emphasis ? 'support-metric-emphasis' : '')}><p>{label}</p><strong>{value}</strong></div>;
}

export function SupportField({ label, value }: { label: string; value?: string | number | null }) {
  const displayValue = value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
    ? 'Não informado'
    : String(value);

  return <div className="support-field"><span className="support-field-label">{label}</span><input className="support-readonly-input" readOnly aria-readonly="true" value={displayValue} /></div>;
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) { return <div className="support-key-value"><dt>{label}</dt><dd>{value}</dd></div>; }
export function EmptyState({ title, description, className }: { title: string; description?: string; className?: string }) {
  return <div className={cn('support-empty-state', className)}><p className="support-empty-state-title">{title}</p>{description ? <p className="support-empty-state-description">{description}</p> : null}</div>;
}

const statusToneByValue: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  ATIVO: 'success',
  ACTIVE: 'success',
  APPROVED: 'success',
  CONFIRMED: 'success',
  CONECTADA: 'success',
  CONNECTED: 'success',
  DONE: 'success',
  PAGO: 'success',
  PROCESSADO: 'success',
  PROCESSED: 'success',
  RECEIVED: 'success',
  RECEIVED_IN_CASH: 'success',
  RESOLVED: 'success',
  SUCESSO: 'success',
  SUCCESS: 'success',
  OPERATIONAL: 'success',
  A_VENCER: 'info',
  IN_PROGRESS: 'warning',
  PENDING_CONFIGURATION: 'warning',
  CONNECTING: 'warning',
  WEBHOOK_PENDING: 'warning',
  OPEN: 'warning',
  PENDING: 'warning',
  PENDENTE: 'warning',
  PROCESSANDO: 'warning',
  PROCESSING: 'warning',
  WAITING: 'warning',
  AWAITING_APPROVAL: 'warning',
  KYC_PENDING: 'warning',
  UNDER_REVIEW: 'warning',
  EXPIRING_SOON: 'warning',
  ATRASADO: 'danger',
  ERROR: 'danger',
  ERRO: 'danger',
  FAILED: 'danger',
  CANCELED: 'danger',
  CANCELLED: 'danger',
  PAID: 'success',
  OVERDUE: 'danger',
  REJECTED: 'danger',
  REJEITADO: 'danger',
  BLOCKED: 'danger',
  DELETION_FAILED: 'danger',
  DRIFT: 'danger',
  INTERRUPTED: 'danger',
  INVALID: 'danger',
  INVALID_URL: 'danger',
  AUTH_TOKEN_MISMATCH: 'danger',
  REVOKED: 'danger',
  EXPIRED: 'danger',
  ESTORNADO: 'info',
  ESTORNADO_PARCIAL: 'info',
  REFUNDED: 'info',
};

export function StatusBadge({ value, label, tone }: { value?: string | null; label?: string; tone?: 'success' | 'warning' | 'danger' | 'info' }) {
  const normalizedValue = value?.trim().toUpperCase();
  const semanticClass = tone
    ? `admin-badge-${tone}`
    : normalizedValue && statusToneByValue[normalizedValue]
      ? `admin-badge-${statusToneByValue[normalizedValue]}`
      : '';
  return <Badge className={semanticClass}>{label || formatSupportStatus(value)}</Badge>;
}
export function RowLink({ href, title, description, meta, className }: { href: string; title: string; description?: string; meta?: ReactNode; className?: string }) { return <Link href={href} className={cn('flex items-center justify-between gap-4 rounded-md border border-slate-200 px-4 py-3 hover:border-slate-300 hover:bg-slate-50', className)}><span><span className="block text-sm font-medium text-slate-950">{title}</span>{description ? <span className="mt-1 block text-sm text-slate-500">{description}</span> : null}{meta ? <span className="mt-2 flex flex-wrap gap-2">{meta}</span> : null}</span><Icon name="ChevronRight" className="shrink-0 text-slate-400" /></Link>; }
