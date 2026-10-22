import { resolveAsaasProcessingFee } from './resolve-asaas-processing-fee';

export type StoreSaleReceiptChargeSnapshot = {
  id: string;
  asaasPaymentId: string | null;
  status: string;
  asaasStatus: string | null;
  asaasValue: number | null;
  asaasNetValue: number | null;
  asaasFeeValue: number | null;
  liquidacaoStatus: string | null;
  liquidadoEm: string | null;
  asaasAnticipated?: boolean | null;
};

export type StoreSaleAnticipationSnapshot = {
  id: string;
  paymentId: string | null;
  installmentId: string | null;
  status: string;
  fee: number | null;
  netValue: number | null;
};

export type StoreSaleAdditionalFeeSnapshot = {
  asaasTransactionId: string;
  paymentId: string | null;
  type: string;
  description: string;
  value: number;
};

export type StoreSaleAdditionalFee = {
  asaasTransactionId: string;
  description: string;
  value: number;
};

export type StoreSaleReceiptFinancials = {
  totalChargeCount: number;
  confirmedChargeCount: number;
  awaitingCreditChargeCount: number;
  receivedChargeCount: number;
  cashReceivedChargeCount: number;
  pendingChargeCount: number;
  processingFeeRecorded: number | null;
  processingFeeComplete: boolean;
  anticipationFeeRecorded: number | null;
  anticipationFeeExpected: number | null;
  additionalFees: StoreSaleAdditionalFee[];
  additionalFeesRecorded: number | null;
  additionalFeesComplete: boolean;
  anticipationStatus: 'UNAVAILABLE' | 'PENDING' | 'CREDITED' | 'INCOMPLETE' | 'AMBIGUOUS' | 'NOT_ANTICIPATED' | 'UNKNOWN';
  totalFeesRecorded: number | null;
  netConfirmedRecorded: number | null;
  netReceivedRecorded: number | null;
  netCashReceivedRecorded: number | null;
  profitAfterConfirmedFees: number | null;
  marginAfterConfirmedFees: number | null;
  profitAfterRecordedFees: number | null;
  marginAfterRecordedFees: number | null;
  realizationStatus: 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'INCOMPLETE' | 'SUPPRESSED';
  limitation: string | null;
};

type ComputeStoreSaleReceiptFinancialsInput = {
  charges: StoreSaleReceiptChargeSnapshot[];
  anticipations: StoreSaleAnticipationSnapshot[];
  additionalFees?: StoreSaleAdditionalFeeSnapshot[];
  additionalFeesComplete: boolean;
  asaasInstallmentId: string | null;
  totalCost: number | null;
  totalAmount?: number | null;
  hasReturns: boolean;
  canceled: boolean;
};

function validMoney(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}
function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function computeProfitMargin(profit: number | null, totalAmount: number | null | undefined): number | null {
  if (profit === null || totalAmount == null || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    return null;
  }
  return Number(((profit / totalAmount) * 100).toFixed(4));
}

function getProcessingFee(charge: StoreSaleReceiptChargeSnapshot): number | null {
  return resolveAsaasProcessingFee({
    explicitFee: charge.asaasFeeValue,
    grossValue: charge.asaasValue,
    netValue: charge.asaasNetValue,
  });
}

function getChargeNet(charge: StoreSaleReceiptChargeSnapshot): number | null {
  return validMoney(charge.asaasNetValue);
}

function isNormallyReceived(charge: StoreSaleReceiptChargeSnapshot): boolean {
  if (charge.status !== 'PAID') return false;
  if (charge.asaasStatus === 'CONFIRMED') return false;
  if (charge.asaasStatus === 'RECEIVED') return true;
  if (charge.asaasStatus !== null) return false;
  return charge.liquidacaoStatus === 'DISPONIVEL';
}

function isReceivedInCash(charge: StoreSaleReceiptChargeSnapshot): boolean {
  return charge.status === 'PAID' && charge.asaasStatus === 'RECEIVED_IN_CASH';
}

function isPaymentConfirmed(charge: StoreSaleReceiptChargeSnapshot): boolean {
  return (
    isNormallyReceived(charge) ||
    isReceivedInCash(charge) ||
    (charge.status === 'PAID' && charge.asaasStatus === 'CONFIRMED')
  );
}

const IGNORED_ANTICIPATION_STATUSES = new Set(['DENIED', 'CANCELLED', 'CANCELED']);
const PENDING_ANTICIPATION_STATUSES = new Set(['PENDING', 'SCHEDULED']);
const PAYMENT_FEE_TYPES = new Set([
  'PAYMENT_FEE',
  'PAYMENT_FEE_REVERSAL',
  'RECEIVABLE_ANTICIPATION_PAYMENT_FEE',
  'RECEIVABLE_ANTICIPATION_PAYMENT_FEE_REVERSAL',
  'RECEIVABLE_ANTICIPATION_FEE',
  'RECEIVABLE_ANTICIPATION_FEE_REVERSAL',
]);
const PENDING_PROVIDER_ADJUSTMENT_STATUSES = new Set([
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
]);
const SUPPRESSED_PROVIDER_STATUSES = new Set([
  'REFUNDED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);
const AMBIGUOUS_FEE_TYPES = new Set([
  'PAYMENT_FEE_REVERSAL',
  'RECEIVABLE_ANTICIPATION_PAYMENT_FEE_REVERSAL',
  'RECEIVABLE_ANTICIPATION_FEE_REVERSAL',
  'CHARGED_FEE_REFUND',
  'REFUND_REQUEST_FEE',
  'REFUND_REQUEST_FEE_REVERSAL',
]);

function isAdditionalFeeType(type: string): boolean {
  return (
    type === 'CREDIT_BUREAU_REPORT' ||
    (!PAYMENT_FEE_TYPES.has(type) && /(?:^|_)FEE(?:_|$)/.test(type))
  );
}

export function computeStoreSaleReceiptFinancials(
  input: ComputeStoreSaleReceiptFinancialsInput,
): StoreSaleReceiptFinancials {
  const chargeIds = new Set<string>();
  const paymentIds = new Set<string>();
  const charges = input.charges.filter((charge) => {
    if (chargeIds.has(charge.id)) return false;
    if (charge.asaasPaymentId && paymentIds.has(charge.asaasPaymentId)) return false;
    chargeIds.add(charge.id);
    if (charge.asaasPaymentId) paymentIds.add(charge.asaasPaymentId);
    return true;
  });

  const uniqueAnticipations = new Map<string, StoreSaleAnticipationSnapshot>();
  input.anticipations.forEach((anticipation) => {
    if (!uniqueAnticipations.has(anticipation.id)) uniqueAnticipations.set(anticipation.id, anticipation);
  });
  const activeAnticipations = [...uniqueAnticipations.values()].filter(
    (anticipation) => !IGNORED_ANTICIPATION_STATUSES.has(anticipation.status),
  );
  const additionalFeeCandidates = new Map<string, StoreSaleAdditionalFeeSnapshot>();
  (input.additionalFees ?? []).forEach((fee) => {
    if (
      fee.paymentId &&
      paymentIds.has(fee.paymentId) &&
      Number.isFinite(fee.value) &&
      !additionalFeeCandidates.has(fee.asaasTransactionId)
    ) {
      additionalFeeCandidates.set(fee.asaasTransactionId, fee);
    }
  });

  const anticipationByPayment = new Map<string, StoreSaleAnticipationSnapshot[]>();
  const planAnticipations: StoreSaleAnticipationSnapshot[] = [];
  for (const anticipation of activeAnticipations) {
    if (anticipation.paymentId && paymentIds.has(anticipation.paymentId)) {
      const linked = anticipationByPayment.get(anticipation.paymentId) ?? [];
      linked.push(anticipation);
      anticipationByPayment.set(anticipation.paymentId, linked);
    } else if (
      !anticipation.paymentId &&
      input.asaasInstallmentId &&
      anticipation.installmentId === input.asaasInstallmentId
    ) {
      planAnticipations.push(anticipation);
    }
  }

  const hasPaymentAnticipations = [...anticipationByPayment.values()].some((items) => items.length > 0);
  const hasCreditedPlanAnticipation = planAnticipations.some((item) => item.status === 'CREDITED');
  const hasPendingAnticipation = activeAnticipations.some((item) =>
    PENDING_ANTICIPATION_STATUSES.has(item.status),
  );
  const hasAmbiguousAnticipation =
    (hasPaymentAnticipations && planAnticipations.length > 0) ||
    [...anticipationByPayment.values()].some((items) => items.length > 1) ||
    planAnticipations.length > 1;

  let anticipationStatus: StoreSaleReceiptFinancials['anticipationStatus'] = 'UNAVAILABLE';
  let anticipationFeeRecorded: number | null = null;
  let anticipationFeeExpected: number | null = null;
  let anticipationUncertainty = false;
  const anticipationNetByPayment = new Map<string, number>();
  let creditedPlanAnticipation: StoreSaleAnticipationSnapshot | null = null;

  if (hasAmbiguousAnticipation) {
    anticipationStatus = 'AMBIGUOUS';
    anticipationUncertainty = true;
  } else if (hasPendingAnticipation) {
    anticipationStatus = 'PENDING';
    anticipationUncertainty = true;
    const linkedPendingAnticipations = [
      ...[...anticipationByPayment.values()].flat().filter((item) =>
        PENDING_ANTICIPATION_STATUSES.has(item.status),
      ),
      ...planAnticipations.filter((item) => PENDING_ANTICIPATION_STATUSES.has(item.status)),
    ];
    if (
      linkedPendingAnticipations.length > 0 &&
      linkedPendingAnticipations.every((item) => validMoney(item.fee) !== null)
    ) {
      anticipationFeeExpected = roundMoney(
        linkedPendingAnticipations.reduce((sum, item) => sum + (validMoney(item.fee) ?? 0), 0),
      );
    }
  } else if (hasPaymentAnticipations || hasCreditedPlanAnticipation) {
    const linkedAnticipations = [
      ...[...anticipationByPayment.values()].flat(),
      ...planAnticipations.filter((item) => item.status === 'CREDITED'),
    ];
    if (
      linkedAnticipations.some(
        (item) => item.status !== 'CREDITED' || validMoney(item.fee) === null,
      )
    ) {
      anticipationStatus = 'INCOMPLETE';
      anticipationUncertainty = true;
    } else {
      anticipationStatus = 'CREDITED';
      anticipationFeeRecorded = roundMoney(
        linkedAnticipations.reduce((sum, item) => sum + (validMoney(item.fee) ?? 0), 0),
      );
      for (const [paymentId, items] of anticipationByPayment) {
        const snapshot = items[0];
        const finalNet = validMoney(snapshot.netValue);
        const charge = charges.find((item) => item.asaasPaymentId === paymentId);
        const baseNet = charge ? getChargeNet(charge) : null;
        const fee = validMoney(snapshot.fee);
        if (finalNet !== null) {
          anticipationNetByPayment.set(paymentId, finalNet);
        } else if (baseNet !== null && fee !== null && baseNet >= fee) {
          anticipationNetByPayment.set(paymentId, roundMoney(baseNet - fee));
        } else {
          anticipationUncertainty = true;
        }
      }
      creditedPlanAnticipation = planAnticipations.find((item) => item.status === 'CREDITED') ?? null;
    }
  } else if (activeAnticipations.some((item) => !PENDING_ANTICIPATION_STATUSES.has(item.status))) {
    anticipationStatus = 'INCOMPLETE';
    anticipationUncertainty = true;
  }

  const anticipatedPaymentIds = new Set(anticipationNetByPayment.keys());
  const confirmedCharges = charges.filter(
    (charge) =>
      isPaymentConfirmed(charge) ||
      (charge.asaasPaymentId !== null && anticipatedPaymentIds.has(charge.asaasPaymentId)),
  );
  const confirmedAsaasCharges = confirmedCharges.filter((charge) => !isReceivedInCash(charge));
  const receivedCharges = charges.filter(
    (charge) =>
      isNormallyReceived(charge) ||
      (charge.asaasPaymentId !== null && anticipatedPaymentIds.has(charge.asaasPaymentId)),
  );
  const cashReceivedCharges = charges.filter(isReceivedInCash);
  const confirmedPaymentIds = new Set(
    confirmedCharges.flatMap((charge) => (charge.asaasPaymentId ? [charge.asaasPaymentId] : [])),
  );
  const confirmedAdditionalFeeCandidates = [...additionalFeeCandidates.values()].filter(
    (fee) => fee.paymentId !== null && confirmedPaymentIds.has(fee.paymentId),
  );
  const additionalFeeUncertainty = confirmedAdditionalFeeCandidates.some((fee) =>
    AMBIGUOUS_FEE_TYPES.has(fee.type),
  );
  const additionalFees = confirmedAdditionalFeeCandidates
    .filter((fee) => isAdditionalFeeType(fee.type))
    .map((fee) => ({
      asaasTransactionId: fee.asaasTransactionId,
      description: fee.description,
      // Ledger debits are negative; expose fees as costs (positive), so a positive reversal reduces them.
      value: roundMoney(-fee.value),
    }));
  const additionalFeesRecorded = additionalFees.length > 0
    ? roundMoney(additionalFees.reduce((sum, fee) => sum + fee.value, 0))
    : null;
  const pendingChargeCount = charges.length - confirmedCharges.length;
  const awaitingCreditChargeCount = confirmedCharges.length - receivedCharges.length - cashReceivedCharges.length;
  const hasPendingProviderAdjustment = charges.some((charge) =>
    PENDING_PROVIDER_ADJUSTMENT_STATUSES.has(charge.asaasStatus ?? ''),
  );
  // Preserve fee evidence already recorded for locally paid charges, even when a later
  // refund/chargeback status suppresses final proceeds. Open charges are never estimated.
  const feeEvidenceCharges = charges.filter((charge) => charge.status === 'PAID');
  const processingFees = feeEvidenceCharges.map(getProcessingFee);
  const processingFeeComplete = charges.length > 0 && charges.every((charge) =>
    charge.status === 'PAID' && getProcessingFee(charge) !== null,
  );
  const processingFeeRecorded = processingFees.some((fee) => fee !== null)
    ? roundMoney(processingFees.reduce<number>((sum, fee) => sum + (fee ?? 0), 0))
    : null;

  const getNetValues = (chargesToSum: StoreSaleReceiptChargeSnapshot[]) => chargesToSum.map((charge) => {
    if (charge.asaasPaymentId && anticipationNetByPayment.has(charge.asaasPaymentId)) {
      return anticipationNetByPayment.get(charge.asaasPaymentId) ?? null;
    }
    return getChargeNet(charge);
  });
  const confirmedNets = getNetValues(confirmedAsaasCharges);
  const receivedNets = getNetValues(receivedCharges);
  const cashReceivedNets = getNetValues(cashReceivedCharges);
  const confirmedNetComplete = confirmedNets.every((value) => value !== null);
  const receivedNetComplete = receivedNets.every((value) => value !== null);
  const cashReceivedNetComplete = cashReceivedNets.every((value) => value !== null);
  const getAdditionalFeesFor = (chargesToSum: StoreSaleReceiptChargeSnapshot[]) => {
    const paymentIdsToSum = new Set(
      chargesToSum.flatMap((charge) => (charge.asaasPaymentId ? [charge.asaasPaymentId] : [])),
    );
    return [...additionalFeeCandidates.values()]
      .filter((fee) => fee.paymentId !== null && paymentIdsToSum.has(fee.paymentId))
      .filter((fee) => isAdditionalFeeType(fee.type))
      .reduce((sum, fee) => sum - fee.value, 0);
  };
  const confirmedAdditionalFees = getAdditionalFeesFor(confirmedAsaasCharges);
  const receivedAdditionalFees = getAdditionalFeesFor(receivedCharges);
  const cashReceivedAdditionalFees = getAdditionalFeesFor(cashReceivedCharges);
  const hasRefundedCharge = charges.some(
    (charge) => charge.status === 'REFUNDED' || charge.asaasStatus === 'REFUNDED',
  );
  const hasSuppressedProviderStatus = charges.some((charge) =>
    SUPPRESSED_PROVIDER_STATUSES.has(charge.asaasStatus ?? ''),
  );
  const hasExcludedSaleAdjustments =
    input.hasReturns || input.canceled || hasRefundedCharge || hasSuppressedProviderStatus;
  let netConfirmedRecorded: number | null = null;
  let netReceivedRecorded: number | null = null;
  let netCashReceivedRecorded: number | null = null;
  if (
    confirmedAsaasCharges.length > 0 &&
    confirmedNetComplete &&
    input.additionalFeesComplete &&
    !anticipationUncertainty &&
    !additionalFeeUncertainty &&
    !hasPendingProviderAdjustment &&
    !hasExcludedSaleAdjustments
  ) {
    if (creditedPlanAnticipation) {
      if (pendingChargeCount === 0) {
        const baseNetTotal = confirmedNets.reduce<number>((sum, value) => sum + (value ?? 0), 0);
        const planFee = validMoney(creditedPlanAnticipation.fee);
        if (planFee !== null && baseNetTotal >= planFee) {
          netConfirmedRecorded = roundMoney(baseNetTotal - planFee - confirmedAdditionalFees);
        }
      }
    } else {
      netConfirmedRecorded = roundMoney(
        confirmedNets.reduce<number>((sum, value) => sum + (value ?? 0), 0) - confirmedAdditionalFees,
      );
    }
  }
  if (
    cashReceivedCharges.length > 0 &&
    cashReceivedNetComplete &&
    input.additionalFeesComplete &&
    !anticipationUncertainty &&
    !additionalFeeUncertainty &&
    !hasPendingProviderAdjustment &&
    !hasExcludedSaleAdjustments
  ) {
    netCashReceivedRecorded = roundMoney(
      cashReceivedNets.reduce<number>((sum, value) => sum + (value ?? 0), 0) - cashReceivedAdditionalFees,
    );
  }
  if (
    receivedCharges.length > 0 &&
    receivedNetComplete &&
    input.additionalFeesComplete &&
    !anticipationUncertainty &&
    !additionalFeeUncertainty &&
    !hasPendingProviderAdjustment &&
    !hasExcludedSaleAdjustments
  ) {
    if (creditedPlanAnticipation) {
      if (receivedCharges.length === charges.length) {
        const baseNetTotal = receivedNets.reduce<number>((sum, value) => sum + (value ?? 0), 0);
        const planFee = validMoney(creditedPlanAnticipation.fee);
        if (planFee !== null && baseNetTotal >= planFee) {
          netReceivedRecorded = roundMoney(baseNetTotal - planFee - receivedAdditionalFees);
        }
      }
    } else {
      netReceivedRecorded = roundMoney(
        receivedNets.reduce<number>((sum, value) => sum + (value ?? 0), 0) - receivedAdditionalFees,
      );
    }
  }

  const totalFeesRecorded =
    processingFeeRecorded === null && anticipationFeeRecorded === null && additionalFeesRecorded === null
    ? null
    : roundMoney(
        (processingFeeRecorded ?? 0) +
          (anticipationFeeRecorded ?? 0) +
          (additionalFeesRecorded ?? 0),
      );
  const settledNetValues = [...receivedNets, ...cashReceivedNets];
  const allChargesSettled =
    charges.length > 0 && receivedCharges.length + cashReceivedCharges.length === charges.length;
  const settledNetComplete =
    allChargesSettled && settledNetValues.length === charges.length && settledNetValues.every((value) => value !== null);
  const settledAdditionalFees = getAdditionalFeesFor(charges.filter((charge) =>
    receivedCharges.includes(charge) || cashReceivedCharges.includes(charge),
  ));
  let netAllSettledRecorded: number | null = null;
  if (
    settledNetComplete &&
    input.additionalFeesComplete &&
    !anticipationUncertainty &&
    !additionalFeeUncertainty &&
    !hasPendingProviderAdjustment &&
    !hasExcludedSaleAdjustments
  ) {
    const settledBaseNet = settledNetValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (creditedPlanAnticipation) {
      const planFee = validMoney(creditedPlanAnticipation.fee);
      if (planFee !== null && settledBaseNet >= planFee) {
        netAllSettledRecorded = roundMoney(settledBaseNet - planFee - settledAdditionalFees);
      }
    } else {
      netAllSettledRecorded = roundMoney(settledBaseNet - settledAdditionalFees);
    }
  }

  const noAnticipationConfirmed = charges.length > 0 && charges.every((charge) => charge.asaasAnticipated === false);
  if (anticipationStatus === 'UNAVAILABLE') {
    anticipationStatus = noAnticipationConfirmed ? 'NOT_ANTICIPATED' : 'UNKNOWN';
    if (!noAnticipationConfirmed) anticipationUncertainty = true;
  }

  const profitAfterRecordedFees =
    netAllSettledRecorded !== null &&
    input.totalCost !== null &&
    Number.isFinite(input.totalCost) &&
    input.totalCost >= 0 &&
    processingFeeComplete &&
    input.additionalFeesComplete &&
    (!anticipationUncertainty) &&
    !hasExcludedSaleAdjustments &&
    !hasPendingProviderAdjustment
      ? roundMoney(netAllSettledRecorded - input.totalCost)
      : null;
  const profitAfterConfirmedFees =
    netConfirmedRecorded !== null &&
    pendingChargeCount === 0 &&
    cashReceivedCharges.length === 0 &&
    input.totalCost !== null &&
    Number.isFinite(input.totalCost) &&
    input.totalCost >= 0 &&
    processingFeeComplete &&
    input.additionalFeesComplete &&
    !hasExcludedSaleAdjustments &&
    !hasPendingProviderAdjustment
      ? roundMoney(netConfirmedRecorded - input.totalCost)
      : null;

  let realizationStatus: StoreSaleReceiptFinancials['realizationStatus'] = 'INCOMPLETE';
  if (hasExcludedSaleAdjustments) realizationStatus = 'SUPPRESSED';
  else if (hasPendingProviderAdjustment) realizationStatus = 'PENDING';
  else if (charges.length === 0 || confirmedCharges.length === 0) realizationStatus = 'PENDING';
  else if (pendingChargeCount > 0 || awaitingCreditChargeCount > 0) realizationStatus = 'PARTIAL';
  else if (
    profitAfterRecordedFees !== null &&
    (anticipationStatus === 'CREDITED' || anticipationStatus === 'NOT_ANTICIPATED')
  ) {
    realizationStatus = 'COMPLETE';
  }

  const limitation = [hasPendingProviderAdjustment
    ? 'Estorno solicitado ou em andamento; líquido e lucro aguardam confirmação.'
    : hasExcludedSaleAdjustments
    ? 'Venda cancelada ou com devolução/estorno; líquido final e lucro após taxas não estão disponíveis.'
      : pendingChargeCount > 0
      ? `Aguardando confirmação do recebimento de ${pendingChargeCount} ${pendingChargeCount === 1 ? 'cobrança' : 'cobranças'}.`
        : awaitingCreditChargeCount > 0
          ? `Aguardando liberação do saldo de ${awaitingCreditChargeCount} cobrança(s) confirmada(s).`
      : anticipationStatus === 'UNKNOWN'
        ? 'Aguardando confirmação sobre antecipação.'
        : !input.additionalFeesComplete
          ? 'Aguardando sincronização completa das taxas adicionais do Asaas.'
        : anticipationUncertainty
          ? 'Dados de antecipação pendentes, incompletos ou ambíguos; o líquido final não pode ser confirmado.'
          : !processingFeeComplete
            ? 'Dados de tarifas de processamento incompletos para cobranças recebidas.'
            : input.totalCost === null
              ? 'Custo histórico da venda indisponível; lucro após taxas não pode ser calculado.'
              : null,
    additionalFeeUncertainty
      ? 'Há uma taxa de estorno cuja relação com o recebimento não pode ser confirmada.'
      : null,
    'Taxas sem vínculo direto com as cobranças não podem ser atribuídas a esta venda.',
  ].filter(Boolean).join(' ');

  return {
    totalChargeCount: charges.length,
    confirmedChargeCount: confirmedCharges.length,
    awaitingCreditChargeCount,
    receivedChargeCount: receivedCharges.length,
    cashReceivedChargeCount: cashReceivedCharges.length,
    pendingChargeCount,
    processingFeeRecorded,
    processingFeeComplete,
    anticipationFeeRecorded,
    anticipationFeeExpected,
    additionalFees,
    additionalFeesRecorded,
    additionalFeesComplete: input.additionalFeesComplete,
    anticipationStatus,
    totalFeesRecorded,
    netConfirmedRecorded,
    netReceivedRecorded,
    netCashReceivedRecorded,
    profitAfterConfirmedFees,
    marginAfterConfirmedFees: computeProfitMargin(profitAfterConfirmedFees, input.totalAmount),
    profitAfterRecordedFees,
    marginAfterRecordedFees: computeProfitMargin(profitAfterRecordedFees, input.totalAmount),
    realizationStatus,
    limitation,
  };
}
