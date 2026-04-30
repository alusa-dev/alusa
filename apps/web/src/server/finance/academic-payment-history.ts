import {
  isAsaasEnabled,
  mapAsaasPaymentStatusToCobranca,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';

import {
  buildAcademicAsaasData,
  mapBillingTypeToFormaPagamento,
  shouldFetchAcademicAsaasDetail,
} from './asaas-payment-detail-policy';

const TERMINAL_LOCAL_COBRANCA_STATUSES = new Set(['PAGO', 'CANCELADO', 'ESTORNADO']);
const TERMINAL_ASAAS_PAYMENT_STATUSES = new Set([
  'RECEIVED',
  'CONFIRMED',
  'DUNNING_RECEIVED',
  'RECEIVED_IN_CASH',
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DELETED',
]);

export const HISTORICAL_ASAAS_PAYMENT_STATUSES = [
  'RECEIVED',
  'CONFIRMED',
  'DUNNING_RECEIVED',
  'RECEIVED_IN_CASH',
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
] as const;

const HISTORICAL_ASAAS_PAYMENT_STATUS_SET = new Set<string>(HISTORICAL_ASAAS_PAYMENT_STATUSES);
const HISTORICAL_LOCAL_COBRANCA_STATUSES = new Set(['PAGO', 'ESTORNADO']);

type AcademicLatestPagamentoRecord = {
  id: string;
  status: string;
  valorPago: unknown;
  dataPagamento: Date | null;
  formaPagamento: string;
  comprovante?: string | null;
  asaasPaymentId: string | null;
  createdAt: Date;
};

export type AcademicChargeHistoryRecord = {
  id: string;
  status: string;
  valor: unknown;
  vencimento: Date;
  dataPagamento: Date | null;
  pagoEm: Date | null;
  pagoPor?: string | null;
  formaPagamento?: string | null;
  asaasPaymentId: string | null;
  asaasStatus?: string | null;
  asaasValue?: unknown;
  asaasNetValue?: unknown;
  lastAsaasFetchAt?: Date | null;
  createdAt: Date;
  pagamentos?: AcademicLatestPagamentoRecord[];
};

export type AcademicHistoricalPayment = {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  comprovante: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoString(value?: Date | null): string | null {
  if (!value) return null;
  return value.toISOString();
}

function toUpper(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

export function resolveAcademicDisplayedStatus(params: {
  localCobrancaStatus: string;
  remotePaymentStatus?: string | null;
  dueDate: Date;
}): string {
  if (!params.remotePaymentStatus) {
    return params.localCobrancaStatus;
  }

  const remoteStatus = mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, {
    dueDate: params.dueDate,
  });

  if (
    TERMINAL_LOCAL_COBRANCA_STATUSES.has(params.localCobrancaStatus) &&
    !TERMINAL_ASAAS_PAYMENT_STATUSES.has(params.remotePaymentStatus)
  ) {
    return params.localCobrancaStatus;
  }

  return remoteStatus;
}

export function hasAcademicPaymentHistory(cobranca: AcademicChargeHistoryRecord): boolean {
  if ((cobranca.pagamentos?.length ?? 0) > 0) {
    return true;
  }

  if (cobranca.dataPagamento || cobranca.pagoEm) {
    return true;
  }

  const snapshotStatus = toUpper(cobranca.asaasStatus);
  if (snapshotStatus && HISTORICAL_ASAAS_PAYMENT_STATUS_SET.has(snapshotStatus)) {
    return true;
  }

  return HISTORICAL_LOCAL_COBRANCA_STATUSES.has(toUpper(cobranca.status) ?? '');
}

export function resolveAcademicHistoricalPayment(
  cobranca: AcademicChargeHistoryRecord,
): AcademicHistoricalPayment | null {
  const pagamento = cobranca.pagamentos?.[0] ?? null;
  if (pagamento) {
    return {
      id: pagamento.id,
      status: pagamento.status,
      valorPago: toNumber(pagamento.valorPago),
      dataPagamento: toIsoString(pagamento.dataPagamento),
      formaPagamento: pagamento.formaPagamento,
      comprovante: pagamento.comprovante ?? null,
      asaasPaymentId: pagamento.asaasPaymentId,
      createdAt: pagamento.createdAt.toISOString(),
    };
  }

  const asaasData = buildAcademicAsaasData(cobranca as unknown as Record<string, unknown>);
  const snapshotStatus = toUpper(asaasData?.status);
  const paymentDate = cobranca.dataPagamento ?? cobranca.pagoEm;
  const localStatus = toUpper(cobranca.status);

  if (
    !paymentDate &&
    !HISTORICAL_LOCAL_COBRANCA_STATUSES.has(localStatus ?? '') &&
    !HISTORICAL_ASAAS_PAYMENT_STATUS_SET.has(snapshotStatus ?? '')
  ) {
    return null;
  }

  const effectiveStatus =
    snapshotStatus ??
    resolveAcademicDisplayedStatus({
      localCobrancaStatus: cobranca.status,
      remotePaymentStatus: cobranca.asaasStatus ?? null,
      dueDate: cobranca.vencimento,
    });

  return {
    id: asaasData?.id ?? `cobranca:${cobranca.id}`,
    status: effectiveStatus,
    valorPago: toNumber(asaasData?.value ?? cobranca.valor),
    dataPagamento: toIsoString(paymentDate),
    formaPagamento:
      mapBillingTypeToFormaPagamento(asaasData?.billingType) ??
      cobranca.pagoPor ??
      cobranca.formaPagamento ??
      'INDEFINIDO',
    comprovante: null,
    asaasPaymentId: cobranca.asaasPaymentId,
    createdAt: cobranca.createdAt.toISOString(),
  };
}

export function collectAcademicChargeReconciliationIds(params: {
  cobrancas: AcademicChargeHistoryRecord[];
  limit?: number;
}): string[] {
  if (!isAsaasEnabled()) return [];

  const limit = params.limit ?? 50;
  const ids: string[] = [];

  for (const cobranca of params.cobrancas) {
    if (!cobranca.asaasPaymentId) continue;

    if (
      shouldFetchAcademicAsaasDetail({
        forceRefresh: false,
        isAsaasActive: true,
        cobranca: cobranca as unknown as Record<string, unknown>,
      })
    ) {
      ids.push(cobranca.asaasPaymentId);
    }

    if (ids.length >= limit) break;
  }

  return Array.from(new Set(ids)).slice(0, limit);
}

export async function reconcileAsaasPaymentIds(params: {
  contaId: string;
  asaasPaymentIds: Array<string | null | undefined>;
  limit?: number;
}): Promise<{ attempted: number; failed: number }> {
  if (!isAsaasEnabled()) {
    return { attempted: 0, failed: 0 };
  }

  const limit = params.limit ?? 50;
  const uniqueIds = Array.from(
    new Set(
      params.asaasPaymentIds.filter(
        (paymentId): paymentId is string => typeof paymentId === 'string' && paymentId.trim().length > 0,
      ),
    ),
  ).slice(0, limit);

  if (uniqueIds.length === 0) {
    return { attempted: 0, failed: 0 };
  }

  const results = await Promise.allSettled(
    uniqueIds.map((asaasPaymentId) =>
      syncPaymentStateFromAsaas({
        contaId: params.contaId,
        asaasPaymentId,
      }),
    ),
  );

  return {
    attempted: uniqueIds.length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}

export async function reconcileAcademicCharges(params: {
  contaId: string;
  cobrancas: AcademicChargeHistoryRecord[];
  limit?: number;
}): Promise<{ attempted: number; failed: number }> {
  const ids = collectAcademicChargeReconciliationIds({
    cobrancas: params.cobrancas,
    limit: params.limit,
  });

  return reconcileAsaasPaymentIds({
    contaId: params.contaId,
    asaasPaymentIds: ids,
    limit: params.limit,
  });
}