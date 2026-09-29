'use client';

import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  FISCAL_INVOICE_STATUS_BADGE_VARIANT,
  resolveFiscalInvoiceStatusLabel,
} from '@alusa/finance/fiscal-invoice-display-client';

type InvoiceStatusBadgeProps = {
  status: string;
  className?: string;
};

export function InvoiceStatusBadge({ status, className }: InvoiceStatusBadgeProps) {
  const normalized = String(status ?? '').toUpperCase();
  const variant = (FISCAL_INVOICE_STATUS_BADGE_VARIANT[
    normalized as keyof typeof FISCAL_INVOICE_STATUS_BADGE_VARIANT
  ] ?? 'neutral') as BadgeVariant;

  return (
    <Badge variant={variant} className={className}>
      {resolveFiscalInvoiceStatusLabel(status)}
    </Badge>
  );
}

export { FISCAL_INVOICE_STATUS_BADGE_VARIANT as INVOICE_STATUS_BADGE_VARIANT };
export { resolveFiscalInvoiceStatusLabel as resolveInvoiceStatusLabel };
