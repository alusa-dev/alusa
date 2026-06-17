import type { AsaasInvoiceStatus } from '@alusa/asaas';
import type { InvoiceStatus } from '@prisma/client';

export const KNOWN_ASAAS_INVOICE_STATUSES = new Set<string>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
]);

export function mapAsaasInvoiceStatusToInternal(status: AsaasInvoiceStatus): InvoiceStatus | null {
  const normalized = String(status ?? '').toUpperCase();
  if (KNOWN_ASAAS_INVOICE_STATUSES.has(normalized)) {
    return normalized as InvoiceStatus;
  }
  return null;
}

const STATUS_RANK: Record<InvoiceStatus, number> = {
  SCHEDULED: 10,
  SYNCHRONIZED: 20,
  AUTHORIZED: 30,
  PROCESSING_CANCELLATION: 40,
  CANCELED: 50,
  CANCELLATION_DENIED: 50,
  ERROR: 45,
};

const TERMINAL_STATUSES = new Set<InvoiceStatus>(['AUTHORIZED', 'CANCELED', 'CANCELLATION_DENIED', 'ERROR']);

export function isInvoiceTerminalStatus(status: InvoiceStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isInvoiceProviderSyncPending(input: {
  status?: InvoiceStatus | string | null;
  hasProviderInvoice?: boolean | null;
  effectiveDate?: string | null;
  minEffectiveDate?: string | null;
}): boolean {
  if (!input.hasProviderInvoice) return false;

  const status = String(input.status ?? '').toUpperCase();
  if (status === 'PROCESSING_CANCELLATION') return true;
  if (TERMINAL_STATUSES.has(status as InvoiceStatus)) return false;
  if (status === 'SYNCHRONIZED') return true;

  if (status === 'SCHEDULED') {
    if (!input.effectiveDate || !input.minEffectiveDate) return true;
    return input.effectiveDate <= input.minEffectiveDate;
  }

  return false;
}

export function isAllowedInvoiceStatusTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  if (to === 'ERROR') return true;
  if (from === 'ERROR' && to === 'SCHEDULED') return true;
  return (STATUS_RANK[to] ?? 0) >= (STATUS_RANK[from] ?? 0);
}

export function mapInvoiceWebhookEventToStatus(event: string): InvoiceStatus | null {
  switch (event) {
    case 'INVOICE_CREATED':
      return 'SCHEDULED';
    case 'INVOICE_SYNCHRONIZED':
      return 'SYNCHRONIZED';
    case 'INVOICE_AUTHORIZED':
      return 'AUTHORIZED';
    case 'INVOICE_PROCESSING_CANCELLATION':
      return 'PROCESSING_CANCELLATION';
    case 'INVOICE_CANCELED':
      return 'CANCELED';
    case 'INVOICE_CANCELLATION_DENIED':
      return 'CANCELLATION_DENIED';
    case 'INVOICE_ERROR':
      return 'ERROR';
    case 'INVOICE_UPDATED':
      return null;
    default:
      return null;
  }
}
