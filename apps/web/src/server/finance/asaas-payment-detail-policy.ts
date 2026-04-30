const TERMINAL_COBRANCA_STATUSES = new Set(['PAGO', 'CANCELADO', 'ESTORNADO']);
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

function getAcademicBillingType(cobranca: Record<string, unknown>): string | null {
  const charge = getAcademicChargeRecord(cobranca);
  if (typeof charge?.billingType === 'string' && charge.billingType.trim().length > 0) {
    return charge.billingType;
  }

  return mapFormaPagamentoToBillingType(cobranca.formaPagamento as string | null | undefined);
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
    status: null,
    value: toNullableNumber(charge.value),
    netValue: null,
    dueDate: toDateOnlyString(charge.dueDate as Date | string | null | undefined),
    paymentDate: null,
    clientPaymentDate: null,
    creditDate: null,
    invoiceUrl: typeof charge.invoiceUrl === 'string' ? charge.invoiceUrl : null,
    billingType: mapFormaPagamentoToBillingType(charge.billingType as string | null | undefined),
  };
}

export function shouldFetchAcademicAsaasDetail(params: {
  forceRefresh: boolean;
  isAsaasActive: boolean;
  cobranca: Record<string, unknown>;
}): boolean {
  if (!params.isAsaasActive) return false;
  if (typeof params.cobranca.asaasPaymentId !== 'string' || !params.cobranca.asaasPaymentId) return false;
  if (params.forceRefresh) return true;

  const localAsaasData = buildAcademicAsaasData(params.cobranca);
  const missingOfficialAccessLink = !localAsaasData?.invoiceUrl;
  const missingBillingType = !localAsaasData?.billingType;

  if (missingOfficialAccessLink || missingBillingType) {
    return true;
  }

  if (hasAcademicAsaasSnapshot(params.cobranca)) return false;
  return !TERMINAL_COBRANCA_STATUSES.has(String(params.cobranca.status ?? ''));
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

  const dueDate =
    params.charge.dueDate instanceof Date
      ? params.charge.dueDate
      : params.charge.dueDate
        ? new Date(String(params.charge.dueDate))
        : null;
  if (!dueDate) return true;

  const localStatus = String(params.charge.status ?? '');
  if (localStatus === 'CREATED' || localStatus === 'PAID') return true;

  const freshnessAnchor =
    (params.charge.updatedAt as Date | null | undefined) ??
    (params.charge.statusUpdatedAt as Date | null | undefined) ??
    (params.charge.createdAt as Date | null | undefined) ??
    null;

  if (!freshnessAnchor) return true;

  const now = params.now ?? new Date();
  return now.getTime() - freshnessAnchor.getTime() < DETAIL_REMOTE_RECONCILE_WINDOW_MS;
}
