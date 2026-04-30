export type AssinaturaSnapshot = {
  asaasSubscriptionId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
  billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED' | null;
  value: number | null;
  nextDueDate: string | null;
  deleted: boolean;
  syncError: string | null;
  syncedAt: string;
};

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDateString(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toIsoDateTimeString(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapFormaPagamentoToBillingType(
  value: unknown,
): AssinaturaSnapshot['billingType'] {
  switch (value) {
    case 'BOLETO':
      return 'BOLETO';
    case 'PIX':
      return 'PIX';
    case 'CARTAO_CREDITO':
      return 'CREDIT_CARD';
    case 'INDEFINIDO':
      return 'UNDEFINED';
    default:
      return null;
  }
}

export function mapLocalSubscriptionStatus(status: unknown): AssinaturaSnapshot['status'] {
  switch (status) {
    case 'INACTIVE':
      return 'INACTIVE';
    case 'EXPIRED':
    case 'DELETED':
      return 'EXPIRED';
    default:
      return 'ACTIVE';
  }
}

export function deriveLocalAssinaturaSnapshot(
  matricula: Record<string, unknown>,
  localSubscription: { status: string; updatedAt: Date } | null,
): AssinaturaSnapshot | null {
  const asaasSubscriptionId =
    typeof matricula.asaasSubscriptionId === 'string' && matricula.asaasSubscriptionId.trim().length > 0
      ? matricula.asaasSubscriptionId
      : null;

  if (!asaasSubscriptionId) return null;

  const cobrancas = Array.isArray(matricula.cobrancas)
    ? (matricula.cobrancas as Array<Record<string, unknown>>)
    : [];
  const recorrentes = cobrancas
    .filter((cobranca) => {
      const tipo = String(cobranca.tipo ?? '');
      const status = String(cobranca.status ?? '');
      return (
        (tipo === 'MENSALIDADE' || tipo === 'RECORRENTE') &&
        status !== 'CANCELADO' &&
        status !== 'ESTORNADO'
      );
    })
    .sort((left, right) => {
      const leftTime = left.vencimento instanceof Date ? left.vencimento.getTime() : Number.MAX_SAFE_INTEGER;
      const rightTime = right.vencimento instanceof Date ? right.vencimento.getTime() : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });

  const upcoming =
    recorrentes.find((cobranca) => {
      const vencimento = cobranca.vencimento instanceof Date ? cobranca.vencimento : null;
      return vencimento ? vencimento.getTime() >= Date.now() : false;
    }) ??
    recorrentes.at(-1) ??
    null;

  const billingType =
    mapFormaPagamentoToBillingType(upcoming?.formaPagamento) ??
    mapFormaPagamentoToBillingType(matricula.formaPagamento) ??
    mapFormaPagamentoToBillingType(matricula.formaPagamentoTaxa);
  const value =
    toNullableNumber(upcoming?.valor) ??
    toNullableNumber((matricula.plano as Record<string, unknown> | null | undefined)?.valor) ??
    toNullableNumber((matricula.combo as Record<string, unknown> | null | undefined)?.valor);
  const nextDueDate = toIsoDateString(upcoming?.vencimento);
  const syncedAt =
    toIsoDateTimeString(localSubscription?.updatedAt) ??
    toIsoDateTimeString(upcoming?.updatedAt) ??
    toIsoDateTimeString(matricula.updatedAt) ??
    new Date().toISOString();

  return {
    asaasSubscriptionId,
    status: mapLocalSubscriptionStatus(localSubscription?.status),
    billingType,
    value,
    nextDueDate,
    deleted: localSubscription?.status === 'DELETED',
    syncError: null,
    syncedAt,
  };
}

export function shouldFetchRemoteSubscriptionSnapshot(params: {
  forceRefresh: boolean;
  asaasSubscriptionId: string | null;
  localSubscription: { status: string; updatedAt: Date } | null;
  localSnapshot: AssinaturaSnapshot | null;
}): boolean {
  if (!params.asaasSubscriptionId) return false;
  if (params.forceRefresh) return true;
  if (!params.localSubscription) return true;
  if (params.localSubscription.status === 'REQUESTED') return true;
  return !params.localSnapshot?.billingType || !params.localSnapshot?.nextDueDate;
}
