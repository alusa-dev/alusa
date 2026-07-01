import { hasAsaasSnapshotDrift } from '@alusa/finance';

const TERMINAL_COBRANCA_STATUSES = new Set(['PAGO', 'CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL']);
const TERMINAL_CHARGE_STATUSES = new Set(['PAID', 'CANCELED', 'REFUNDED']);
const DETAIL_REMOTE_RECONCILE_WINDOW_MS = 5 * 60_000;

export function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDateOnlyString(value?: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function mapFormaPagamentoToBillingType(value?: string | null): string | null {
  switch (value) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CARTAO_CREDITO':
      return 'CREDIT_CARD';
    case 'CARTAO_DEBITO':
      return 'DEBIT_CARD';
    case 'INDEFINIDO':
      return 'UNDEFINED';
    default:
      return value ?? null;
  }
}

export function mapBillingTypeToFormaPagamento(value?: string | null): string | null {
  switch (value?.trim().toUpperCase()) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CREDIT_CARD':
      return 'CARTAO_CREDITO';
    case 'DEBIT_CARD':
      return 'CARTAO_DEBITO';
    case 'RECEIVED_IN_CASH':
      return 'INDEFINIDO';
    case 'UNDEFINED':
      return 'INDEFINIDO';
    default:
      return value ?? null;
  }
}

function getAcademicChargeRecord(cobranca: Record<string, unknown>): Record<string, unknown> | null {
  if (!cobranca.charge || typeof cobranca.charge !== 'object' || Array.isArray(cobranca.charge)) {
    return null;
  }

  return cobranca.charge as Record<string, unknown>;
}

function getAcademicInvoiceUrl(cobranca: Record<string, unknown>): string | null {
  const charge = getAcademicChargeRecord(cobranca);
  if (typeof charge?.invoiceUrl !== 'string' || charge.invoiceUrl.trim().length === 0) {
    return null;
  }

  return charge.invoiceUrl;
}

function hasOfficialAccessLink(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function getAcademicBillingType(cobranca: Record<string, unknown>): string | null {
  const charge = getAcademicChargeRecord(cobranca);
  if (typeof charge?.billingType === 'string' && charge.billingType.trim().length > 0) {
    return charge.billingType;
  }

  return mapFormaPagamentoToBillingType(cobranca.formaPagamento as string | null | undefined);
}

function getFreshnessAnchor(record: Record<string, unknown>): Date | null {
  const candidates = [
    record.lastAsaasFetchAt,
    record.statusUpdatedAt,
    record.updatedAt,
    record.createdAt,
  ];

  for (const candidate of candidates) {
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
      return candidate;
    }
    if (candidate) {
      const parsed = new Date(String(candidate));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  return null;
}

function isWithinReconcileWindow(anchor: Date | null, now: Date): boolean {
  if (!anchor) return false;
  return now.getTime() - anchor.getTime() < DETAIL_REMOTE_RECONCILE_WINDOW_MS;
}

export function hasAcademicAsaasSnapshot(cobranca: Record<string, unknown>): boolean {
  return (
    cobranca.asaasStatus != null ||
    cobranca.asaasValue != null ||
    cobranca.asaasNetValue != null ||
    cobranca.asaasOriginalValue != null ||
    cobranca.asaasFeeValue != null ||
    cobranca.asaasCreditDate != null ||
    cobranca.asaasEstimatedCreditDate != null ||
    cobranca.lastAsaasFetchAt != null
  );
}

export function hasStandaloneAsaasSnapshot(charge: Record<string, unknown>): boolean {
  return (
    charge.asaasStatus != null ||
    charge.asaasNetValue != null ||
    charge.asaasOriginalValue != null ||
    charge.lastAsaasFetchAt != null ||
    hasOfficialAccessLink(charge.invoiceUrl)
  );
}

export function buildAcademicAsaasData(cobranca: Record<string, unknown>) {
  const paymentId =
    typeof cobranca.asaasPaymentId === 'string' && cobranca.asaasPaymentId.trim().length > 0
      ? cobranca.asaasPaymentId
      : null;
  const snapshotStatus =
    typeof cobranca.asaasStatus === 'string' && cobranca.asaasStatus.trim().length > 0
      ? cobranca.asaasStatus
      : null;

  if (!paymentId && !snapshotStatus) {
    return null;
  }

  return {
    id: paymentId ?? String(cobranca.id ?? ''),
    status: snapshotStatus,
    value: toNullableNumber(cobranca.asaasValue) ?? toNullableNumber(cobranca.valor),
    netValue: toNullableNumber(cobranca.asaasNetValue),
    originalValue: toNullableNumber(cobranca.asaasOriginalValue),
    dueDate: toDateOnlyString(cobranca.vencimento as Date | string | null | undefined),
    paymentDate: toDateOnlyString(cobranca.dataPagamento as Date | string | null | undefined),
    clientPaymentDate: toDateOnlyString(cobranca.dataPagamento as Date | string | null | undefined),
    creditDate: toDateOnlyString(cobranca.asaasCreditDate as Date | string | null | undefined),
    estimatedCreditDate: toDateOnlyString(
      cobranca.asaasEstimatedCreditDate as Date | string | null | undefined,
    ),
    invoiceUrl: getAcademicInvoiceUrl(cobranca),
    bankSlipUrl: null,
    billingType: getAcademicBillingType(cobranca),
  };
}

export function buildStandaloneAsaasData(charge: Record<string, unknown>) {
  if (!charge.asaasPaymentId && !charge.invoiceUrl) {
    return null;
  }

  return {
    id: String(charge.asaasPaymentId ?? charge.id ?? ''),
    status:
      typeof charge.asaasStatus === 'string' && charge.asaasStatus.trim().length > 0
        ? charge.asaasStatus
        : null,
    value: toNullableNumber(charge.value),
    netValue: toNullableNumber(charge.asaasNetValue),
    originalValue: toNullableNumber(charge.asaasOriginalValue),
    dueDate: toDateOnlyString(charge.dueDate as Date | string | null | undefined),
    paymentDate: null,
    clientPaymentDate: null,
    creditDate: toDateOnlyString(charge.asaasCreditDate as Date | string | null | undefined),
    estimatedCreditDate: toDateOnlyString(charge.asaasEstimatedCreditDate as Date | string | null | undefined),
    invoiceUrl: hasOfficialAccessLink(charge.invoiceUrl) ? String(charge.invoiceUrl) : null,
    bankSlipUrl: null,
    billingType: mapFormaPagamentoToBillingType(charge.billingType as string | null | undefined),
  };
}

export function shouldFetchAcademicAsaasDetail(params: {
  forceRefresh: boolean;
  isAsaasActive: boolean;
  cobranca: Record<string, unknown>;
  now?: Date;
}): boolean {
  if (!params.isAsaasActive) return false;
  if (typeof params.cobranca.asaasPaymentId !== 'string' || !params.cobranca.asaasPaymentId) return false;
  if (params.forceRefresh) return true;

  const now = params.now ?? new Date();
  const hasSnapshot = hasAcademicAsaasSnapshot(params.cobranca);
  const fresh = isWithinReconcileWindow(getFreshnessAnchor(params.cobranca), now);

  if (hasSnapshot && fresh) {
    const academicCharge = getAcademicChargeRecord(params.cobranca);
    if (
      hasAsaasSnapshotDrift({
        asaasStatus:
          typeof params.cobranca.asaasStatus === 'string' ? params.cobranca.asaasStatus : null,
        localCobrancaStatus: String(params.cobranca.status ?? ''),
        localChargeStatus: typeof academicCharge?.status === 'string' ? String(academicCharge.status) : null,
      })
    ) {
      return true;
    }
    return false;
  }

  const localStatus = String(params.cobranca.status ?? '');
  if (!TERMINAL_COBRANCA_STATUSES.has(localStatus)) {
    const localAsaasData = buildAcademicAsaasData(params.cobranca);
    const missingOfficialAccessLink = !localAsaasData?.invoiceUrl;
    const missingBillingType = !localAsaasData?.billingType;

    if (hasSnapshot && (missingOfficialAccessLink || missingBillingType)) {
      return true;
    }

    // Cobrança em aberto: GET read-only usa snapshot local; sync/webhook convergem depois.
    if (hasSnapshot) return false;
    return true;
  }

  const localAsaasData = buildAcademicAsaasData(params.cobranca);
  const missingOfficialAccessLink = !localAsaasData?.invoiceUrl;
  const missingBillingType = !localAsaasData?.billingType;

  if (missingOfficialAccessLink || missingBillingType) {
    return true;
  }

  return !hasSnapshot;
}

export function shouldFetchStandaloneAsaasDetail(params: {
  forceRefresh: boolean;
  isAsaasActive: boolean;
  charge: Record<string, unknown>;
  now?: Date;
}): boolean {
  if (!params.isAsaasActive) return false;
  if (typeof params.charge.asaasPaymentId !== 'string' || !params.charge.asaasPaymentId) return false;
  if (params.forceRefresh) return true;

  const now = params.now ?? new Date();
  const hasSnapshot = hasStandaloneAsaasSnapshot(params.charge);
  const fresh = isWithinReconcileWindow(getFreshnessAnchor(params.charge), now);

  if (hasSnapshot && fresh) {
    if (
      hasAsaasSnapshotDrift({
        asaasStatus: typeof params.charge.asaasStatus === 'string' ? params.charge.asaasStatus : null,
        localChargeStatus: String(params.charge.status ?? ''),
      })
    ) {
      return true;
    }
    return false;
  }

  const localStatus = String(params.charge.status ?? '');
  if (!TERMINAL_CHARGE_STATUSES.has(localStatus)) {
    if (hasSnapshot) return false;
    return true;
  }

  const localAsaasData = buildStandaloneAsaasData(params.charge);
  const missingOfficialAccessLink = !localAsaasData?.invoiceUrl;
  const missingBillingType = !localAsaasData?.billingType;

  if (missingOfficialAccessLink || missingBillingType) {
    return true;
  }

  return !hasSnapshot;
}
