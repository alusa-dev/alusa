import type { InvoiceStatus } from '@prisma/client';

import { isInvoiceProviderSyncPending } from '../mappers/invoice-status.mapper';

export const FISCAL_INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  SCHEDULED: 'Agendada',
  SYNCHRONIZED: 'Enviada à prefeitura',
  AUTHORIZED: 'Emitida',
  PROCESSING_CANCELLATION: 'Cancelamento em processamento',
  CANCELED: 'Cancelada',
  CANCELLATION_DENIED: 'Cancelamento negado',
  ERROR: 'Erro na emissão',
};

export type FiscalInvoiceStatusBadgeVariant =
  | 'info'
  | 'success'
  | 'warning'
  | 'neutral'
  | 'destructive';

export const FISCAL_INVOICE_STATUS_BADGE_VARIANT: Record<
  InvoiceStatus,
  FiscalInvoiceStatusBadgeVariant
> = {
  SCHEDULED: 'info',
  SYNCHRONIZED: 'info',
  AUTHORIZED: 'success',
  PROCESSING_CANCELLATION: 'warning',
  CANCELED: 'neutral',
  CANCELLATION_DENIED: 'warning',
  ERROR: 'destructive',
};

export const FISCAL_INVOICE_PENDING_STATUSES = new Set<InvoiceStatus>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'PROCESSING_CANCELLATION',
]);

export const FISCAL_INVOICE_ERROR_STATUSES = new Set<InvoiceStatus>([
  'ERROR',
  'CANCELLATION_DENIED',
]);

export type FiscalInvoiceKpis = {
  totalNotas: number;
  totalEmitidas: number;
  totalValor: number;
  ultimaNotaEm: string | null;
  comErro: number;
  pendentes: number;
};

export type FiscalInvoiceRowInput = {
  status: InvoiceStatus;
  value: unknown;
  effectiveDate: Date | null;
  statusUpdatedAt: Date;
  asaasInvoiceId?: string | null;
};

export function resolveFiscalInvoiceStatusLabel(status: string | null | undefined): string {
  const normalized = String(status ?? '').toUpperCase() as InvoiceStatus;
  return FISCAL_INVOICE_STATUS_LABELS[normalized] ?? 'Desconhecido';
}

export function resolveFiscalInvoiceBadgeVariant(
  status: string | null | undefined,
): FiscalInvoiceStatusBadgeVariant {
  const normalized = String(status ?? '').toUpperCase() as InvoiceStatus;
  return FISCAL_INVOICE_STATUS_BADGE_VARIANT[normalized] ?? 'neutral';
}

export function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  return Number(value);
}

export function resolveInvoiceSortDate(input: {
  effectiveDate: Date | null;
  statusUpdatedAt: Date;
}): string {
  const date = input.effectiveDate ?? input.statusUpdatedAt;
  return date.toISOString();
}

export function computeFiscalInvoiceKpis(rows: FiscalInvoiceRowInput[]): FiscalInvoiceKpis {
  let totalEmitidas = 0;
  let totalValor = 0;
  let comErro = 0;
  let pendentes = 0;
  let ultimaNotaEm: string | null = null;

  for (const row of rows) {
    if (row.status === 'AUTHORIZED') {
      totalEmitidas += 1;
      totalValor += decimalToNumber(row.value);
    }
    if (FISCAL_INVOICE_ERROR_STATUSES.has(row.status)) {
      comErro += 1;
    }
    if (FISCAL_INVOICE_PENDING_STATUSES.has(row.status)) {
      pendentes += 1;
    }

    const sortDate = resolveInvoiceSortDate(row);
    if (!ultimaNotaEm || sortDate.localeCompare(ultimaNotaEm) > 0) {
      ultimaNotaEm = sortDate;
    }
  }

  return {
    totalNotas: rows.length,
    totalEmitidas,
    totalValor,
    ultimaNotaEm,
    comErro,
    pendentes,
  };
}

export function resolveFiscalInvoiceHighlightStatus(
  rows: FiscalInvoiceRowInput[],
): InvoiceStatus | null {
  if (rows.some((row) => row.status === 'ERROR')) return 'ERROR';
  if (rows.some((row) => row.status === 'CANCELLATION_DENIED')) return 'CANCELLATION_DENIED';
  if (rows.some((row) => row.status === 'PROCESSING_CANCELLATION')) {
    return 'PROCESSING_CANCELLATION';
  }
  if (rows.some((row) => row.status === 'SCHEDULED' || row.status === 'SYNCHRONIZED')) {
    return 'SCHEDULED';
  }
  return null;
}

export function isFiscalInvoiceSyncPending(input: {
  status: InvoiceStatus;
  asaasInvoiceId?: string | null;
  effectiveDate?: Date | null;
  minEffectiveDate?: string | null;
}): boolean {
  return isInvoiceProviderSyncPending({
    status: input.status,
    hasProviderInvoice: Boolean(input.asaasInvoiceId),
    effectiveDate: input.effectiveDate?.toISOString().slice(0, 10) ?? null,
    minEffectiveDate: input.minEffectiveDate ?? null,
  });
}

export const FISCAL_INVOICE_CANCELABLE_STATUSES = new Set<InvoiceStatus>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
]);

/** Notas agendadas ou com erro podem ser revisadas antes da emissão (PUT /v3/invoices/{id}). */
export const FISCAL_INVOICE_EDITABLE_STATUSES = new Set<InvoiceStatus>(['SCHEDULED', 'ERROR']);

export type FiscalInvoiceRowActions = {
  canViewNota: boolean;
  notaUrl: string | null;
  canCancel: boolean;
  canEdit: boolean;
};

export function resolveFiscalInvoiceNotaUrl(input: {
  pdfUrl: string | null;
  xmlUrl: string | null;
}): string | null {
  return input.pdfUrl ?? input.xmlUrl ?? null;
}

export function resolveFiscalInvoiceRowActions(input: {
  status: InvoiceStatus | string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  syncPending: boolean;
}): FiscalInvoiceRowActions {
  const status = String(input.status ?? '').toUpperCase() as InvoiceStatus;
  const notaUrl = resolveFiscalInvoiceNotaUrl(input);

  const canCancel = FISCAL_INVOICE_CANCELABLE_STATUSES.has(status);

  const canEdit =
    FISCAL_INVOICE_EDITABLE_STATUSES.has(status) &&
    status !== 'PROCESSING_CANCELLATION' &&
    !input.syncPending;

  return {
    canViewNota: Boolean(notaUrl),
    notaUrl,
    canCancel,
    canEdit,
  };
}

export function formatFiscalInvoiceCompetencia(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): string | null {
  if (!start || !end) return null;

  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

  const fmt = (date: Date) =>
    date.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });

  if (startDate.getTime() === endDate.getTime()) return fmt(startDate);
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

export function resolveFiscalInvoiceServiceLabel(input: {
  cobrancaDescricao?: string | null;
  planoNome?: string | null;
  turmaNome?: string | null;
  alunoNome?: string | null;
  competenciaInicio?: Date | string | null;
  competenciaFim?: Date | string | null;
}): string {
  const cobrancaLabel = input.cobrancaDescricao?.trim() || null;
  const productLabel = input.planoNome?.trim() || input.turmaNome?.trim() || null;
  const alunoLabel = input.alunoNome?.trim() || null;
  const competenciaLabel = formatFiscalInvoiceCompetencia(
    input.competenciaInicio,
    input.competenciaFim,
  );

  const hasMatriculaContext = Boolean(productLabel || alunoLabel || competenciaLabel);
  if (!hasMatriculaContext) {
    return cobrancaLabel ?? '—';
  }

  const parts = [productLabel, alunoLabel, competenciaLabel].filter(
    (part): part is string => Boolean(part?.trim()),
  );

  return parts.length > 0 ? parts.join(' — ') : cobrancaLabel ?? '—';
}
