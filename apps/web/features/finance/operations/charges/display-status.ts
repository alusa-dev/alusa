import {
  mapAsaasPaymentStatusToCobranca,
  normalizeAsaasPaymentSnapshotStatus,
  resolveLiquidacaoFromAsaasPayment,
  chooseHighestPrecedenceCobrancaDisplayStatus,
  mapChargeStatusToCobrancaDisplayStatus,
  type PaymentOrigin,
} from '@alusa/finance';

export function getEffectiveRemotePaymentStatus(
  payment?: { status?: string | null; deleted?: boolean | null; billingType?: string | null } | null,
) {
  if (!payment) return null;

  return normalizeAsaasPaymentSnapshotStatus({
    status: payment.status,
    billingType: payment.billingType,
    deleted: payment.deleted,
  }) ?? payment.status ?? null;
}

export function resolveAcademicPaymentOrigin(tipo?: string | null): PaymentOrigin {
  switch (tipo) {
    case 'PARCELADA':
      return 'INSTALLMENT';
    case 'RECORRENTE':
      return 'SUBSCRIPTION';
    case 'TAXA_MATRICULA':
      return 'ENROLLMENT_FEE';
    case 'AVULSA':
      return 'STANDALONE';
    default:
      return 'ACADEMIC';
  }
}

export function resolveStandaloneDisplayedStatus(params: {
  localChargeStatus: string;
  remotePaymentStatus?: string | null;
  dueDate?: Date | null;
}) {
  const localStatus = mapChargeStatusToCobrancaDisplayStatus(params.localChargeStatus) ?? 'PENDENTE';
  const remoteStatus = params.remotePaymentStatus
    ? mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, { dueDate: params.dueDate })
    : null;

  return chooseHighestPrecedenceCobrancaDisplayStatus([localStatus, remoteStatus]) ?? localStatus;
}

export function resolveAcademicDisplayedStatus(params: {
  localCobrancaStatus: string;
  localChargeStatus?: string | null;
  remotePaymentStatus?: string | null;
  dueDate: Date;
}) {
  const localChargeMappedStatus = mapChargeStatusToCobrancaDisplayStatus(params.localChargeStatus);
  const remoteStatus = params.remotePaymentStatus
    ? mapAsaasPaymentStatusToCobranca(params.remotePaymentStatus, { dueDate: params.dueDate })
    : null;

  return chooseHighestPrecedenceCobrancaDisplayStatus([
    params.localCobrancaStatus,
    localChargeMappedStatus,
    remoteStatus,
  ]) ?? params.localCobrancaStatus;
}

export function resolveStandaloneLiquidacaoStatus(params: {
  displayedStatus: string;
  remotePaymentStatus?: string | null;
  creditDate?: string | null;
  billingType?: string | null;
}): 'PENDENTE' | 'DISPONIVEL' | 'NAO_APLICAVEL' | null {
  if (params.displayedStatus !== 'PAGO') {
    return null;
  }

  return resolveLiquidacaoFromAsaasPayment({
    asaasStatus: params.remotePaymentStatus,
    creditDate: params.creditDate,
    billingType: params.billingType,
  });
}
