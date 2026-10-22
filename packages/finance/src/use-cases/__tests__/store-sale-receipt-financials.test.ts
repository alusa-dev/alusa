import { describe, expect, it } from 'vitest';

import {
  computeStoreSaleReceiptFinancials as computeReceiptFinancials,
  type StoreSaleAnticipationSnapshot,
  type StoreSaleReceiptChargeSnapshot,
} from '../store-sale-receipt-financials';

function computeStoreSaleReceiptFinancials(
  input: Omit<Parameters<typeof computeReceiptFinancials>[0], 'additionalFeesComplete'>,
) {
  return computeReceiptFinancials({ ...input, additionalFeesComplete: true });
}

function charge(
  overrides: Partial<StoreSaleReceiptChargeSnapshot> = {},
): StoreSaleReceiptChargeSnapshot {
  return {
    id: 'charge-1',
    asaasPaymentId: 'payment-1',
    status: 'PAID',
    asaasStatus: 'RECEIVED',
    asaasValue: 100,
    asaasNetValue: 97,
    asaasFeeValue: 3,
    asaasAnticipated: false,
    liquidacaoStatus: 'DISPONIVEL',
    liquidadoEm: '2026-01-10T12:00:00.000Z',
    ...overrides,
  };
}

function anticipation(
  overrides: Partial<StoreSaleAnticipationSnapshot> = {},
): StoreSaleAnticipationSnapshot {
  return {
    id: 'anticipation-1',
    paymentId: 'payment-1',
    installmentId: null,
    status: 'CREDITED',
    fee: 1,
    netValue: 96,
    ...overrides,
  };
}

describe('store-sale receipt financial breakdown', () => {
  it('shows a confirmed payment fee and net as awaiting credit, not available', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          asaasStatus: 'CONFIRMED',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 400,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      confirmedChargeCount: 1,
      awaitingCreditChargeCount: 1,
      receivedChargeCount: 0,
      processingFeeRecorded: 11.83,
      netConfirmedRecorded: 558.17,
      netReceivedRecorded: null,
      profitAfterRecordedFees: null,
      realizationStatus: 'PARTIAL',
    });
  });

  it('keeps CONFIRMED awaiting credit when local settlement fields conflict', () => {
    for (const localSettlement of [
      { liquidacaoStatus: 'DISPONIVEL' as const, liquidadoEm: null },
      { liquidacaoStatus: null, liquidadoEm: '2026-01-10T12:00:00.000Z' },
    ]) {
      const result = computeStoreSaleReceiptFinancials({
        charges: [
          charge({
            asaasStatus: 'CONFIRMED',
            asaasValue: 570,
            asaasNetValue: 558.17,
            asaasFeeValue: 11.83,
            ...localSettlement,
          }),
        ],
        anticipations: [],
        asaasInstallmentId: null,
        totalCost: 400,
        hasReturns: false,
        canceled: false,
      });

      expect(result).toMatchObject({
        confirmedChargeCount: 1,
        awaitingCreditChargeCount: 1,
        receivedChargeCount: 0,
        netConfirmedRecorded: 558.17,
        netReceivedRecorded: null,
        profitAfterRecordedFees: null,
        realizationStatus: 'PARTIAL',
      });
    }
  });

  it('uses the same local liquidation-status fallback as charge details when remote status is absent', () => {
    const available = computeStoreSaleReceiptFinancials({
      charges: [charge({ asaasStatus: null, liquidacaoStatus: 'DISPONIVEL', liquidadoEm: null })],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 50,
      hasReturns: false,
      canceled: false,
    });
    const dateOnly = computeStoreSaleReceiptFinancials({
      charges: [charge({ asaasStatus: null, liquidacaoStatus: null, liquidadoEm: '2026-01-10T12:00:00.000Z' })],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 50,
      hasReturns: false,
      canceled: false,
    });

    expect(available.receivedChargeCount).toBe(1);
    expect(dateOnly).toMatchObject({
      receivedChargeCount: 0,
      confirmedChargeCount: 0,
      pendingChargeCount: 1,
      netReceivedRecorded: null,
      profitAfterRecordedFees: null,
    });
  });

  it('separates RECEIVED_IN_CASH from Asaas credit while counting it as settled', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          asaasStatus: 'RECEIVED_IN_CASH',
          asaasValue: 100,
          asaasNetValue: 97,
          asaasFeeValue: 3,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 50,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      confirmedChargeCount: 1,
      receivedChargeCount: 0,
      cashReceivedChargeCount: 1,
      awaitingCreditChargeCount: 0,
      netReceivedRecorded: null,
      netCashReceivedRecorded: 97,
      profitAfterRecordedFees: 47,
    });
  });

  it('calculates settled profit across Asaas credit and cash without labeling cash as Asaas credit', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          id: 'asaas-charge',
          asaasPaymentId: 'payment-asaas',
          asaasStatus: 'RECEIVED',
          asaasValue: 100,
          asaasNetValue: 97,
          asaasFeeValue: 3,
        }),
        charge({
          id: 'cash-charge',
          asaasPaymentId: null,
          asaasStatus: 'RECEIVED_IN_CASH',
          asaasValue: 50,
          asaasNetValue: 50,
          asaasFeeValue: 0,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [anticipation({ paymentId: 'payment-asaas', fee: 0, netValue: 97 })],
      asaasInstallmentId: null,
      totalCost: 80,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      confirmedChargeCount: 2,
      receivedChargeCount: 1,
      cashReceivedChargeCount: 1,
      awaitingCreditChargeCount: 0,
      netReceivedRecorded: 97,
      netCashReceivedRecorded: 50,
      profitAfterRecordedFees: 67,
      realizationStatus: 'COMPLETE',
    });
  });

  it('keeps confirmed Asaas net separate from cash while credit is pending', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          id: 'asaas-confirmed-charge',
          asaasPaymentId: 'payment-confirmed',
          asaasStatus: 'CONFIRMED',
          asaasValue: 100,
          asaasNetValue: 97,
          asaasFeeValue: 3,
          liquidacaoStatus: 'DISPONIVEL',
          liquidadoEm: '2026-01-10T12:00:00.000Z',
        }),
        charge({
          id: 'cash-charge',
          asaasPaymentId: null,
          asaasStatus: 'RECEIVED_IN_CASH',
          asaasValue: 50,
          asaasNetValue: 50,
          asaasFeeValue: 0,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 80,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      confirmedChargeCount: 2,
      receivedChargeCount: 0,
      cashReceivedChargeCount: 1,
      awaitingCreditChargeCount: 1,
      netConfirmedRecorded: 97,
      netReceivedRecorded: null,
      netCashReceivedRecorded: 50,
      profitAfterRecordedFees: null,
      realizationStatus: 'PARTIAL',
    });
  });

  it('separates received funds from a payment that is only confirmed', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          asaasStatus: 'RECEIVED',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 400,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      confirmedChargeCount: 1,
      awaitingCreditChargeCount: 0,
      receivedChargeCount: 1,
      processingFeeRecorded: 11.83,
      netConfirmedRecorded: 558.17,
      netReceivedRecorded: 558.17,
      profitAfterRecordedFees: 158.17,
    });
  });

  it('does not count pending installment values in confirmed or available totals', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          asaasStatus: 'CONFIRMED',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
        charge({
          id: 'charge-pending',
          asaasPaymentId: 'payment-pending',
          status: 'OPEN',
          asaasStatus: 'PENDING',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 400,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      totalChargeCount: 2,
      confirmedChargeCount: 1,
      pendingChargeCount: 1,
      awaitingCreditChargeCount: 1,
      receivedChargeCount: 0,
      netConfirmedRecorded: 558.17,
      netReceivedRecorded: null,
      profitAfterRecordedFees: null,
      realizationStatus: 'PARTIAL',
    });
  });

  it('separates received, confirmed-awaiting-credit, and pending installments', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          asaasStatus: 'RECEIVED',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
        }),
        charge({
          id: 'charge-confirmed',
          asaasPaymentId: 'payment-confirmed',
          asaasStatus: 'CONFIRMED',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
        charge({
          id: 'charge-pending',
          asaasPaymentId: 'payment-pending',
          status: 'OPEN',
          asaasStatus: 'PENDING',
          asaasValue: 570,
          asaasNetValue: 558.17,
          asaasFeeValue: 11.83,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 1000,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      totalChargeCount: 3,
      confirmedChargeCount: 2,
      awaitingCreditChargeCount: 1,
      receivedChargeCount: 1,
      pendingChargeCount: 1,
      processingFeeRecorded: 23.66,
      netConfirmedRecorded: 1116.34,
      netReceivedRecorded: 558.17,
      profitAfterRecordedFees: null,
      realizationStatus: 'PARTIAL',
    });
  });

  it('does not report pending payment fees as confirmed or available', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge({
          status: 'OPEN',
          asaasStatus: 'PENDING',
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: null,
      totalCost: 70,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      confirmedChargeCount: 0,
      receivedChargeCount: 0,
      processingFeeRecorded: null,
      netConfirmedRecorded: null,
      netReceivedRecorded: null,
      realizationStatus: 'PENDING',
    });
  });

  it('computes registered processing and credited anticipation fees and uses final payment net', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [charge({ asaasStatus: 'CONFIRMED', liquidacaoStatus: null, liquidadoEm: null })],
      anticipations: [anticipation()],
      asaasInstallmentId: null,
      totalCost: 70,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      receivedChargeCount: 1,
      processingFeeRecorded: 3,
      processingFeeComplete: true,
      anticipationFeeRecorded: 1,
      anticipationStatus: 'CREDITED',
      totalFeesRecorded: 4,
      netReceivedRecorded: 96,
      profitAfterRecordedFees: 26,
      realizationStatus: 'COMPLETE',
    });
  });

  it('ignores denied prior attempts and deduplicates charges by id and payment id', () => {
    const credited = anticipation();
    const result = computeStoreSaleReceiptFinancials({
      charges: [charge(), charge(), charge({ id: 'duplicate-charge', asaasValue: 120 })],
      anticipations: [
        anticipation({ id: 'denied-attempt', status: 'DENIED', fee: 10 }),
        credited,
        credited,
      ],
      asaasInstallmentId: null,
      totalCost: 70,
      hasReturns: false,
      canceled: false,
    });

    expect(result.totalChargeCount).toBe(1);
    expect(result.totalFeesRecorded).toBe(4);
    expect(result.netReceivedRecorded).toBe(96);
  });

  it('withholds final net and profit for a partially paid installment plan', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge(),
        charge({
          id: 'charge-2',
          asaasPaymentId: 'payment-2',
          status: 'OPEN',
          asaasStatus: 'PENDING',
          asaasValue: null,
          asaasNetValue: null,
          asaasFeeValue: null,
          liquidacaoStatus: null,
          liquidadoEm: null,
        }),
      ],
      anticipations: [],
      asaasInstallmentId: 'installment-1',
      totalCost: 70,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      totalChargeCount: 2,
      receivedChargeCount: 1,
      pendingChargeCount: 1,
      netReceivedRecorded: 97,
      profitAfterRecordedFees: null,
      realizationStatus: 'PARTIAL',
    });
  });

  it('charges a uniquely linked credited plan anticipation once at aggregate only', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge(),
        charge({
          id: 'charge-2',
          asaasPaymentId: 'payment-2',
          asaasValue: 100,
          asaasNetValue: 97,
          asaasFeeValue: 3,
        }),
      ],
      anticipations: [
        anticipation({
          paymentId: null,
          installmentId: 'installment-1',
          fee: 4,
          netValue: 100,
        }),
      ],
      asaasInstallmentId: 'installment-1',
      totalCost: 140,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      anticipationFeeRecorded: 4,
      processingFeeRecorded: 6,
      totalFeesRecorded: 10,
      netReceivedRecorded: 190,
      profitAfterRecordedFees: 50,
    });
  });

  it('keeps normal and anticipated received payments together in a mixed sale', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [
        charge(),
        charge({
          id: 'charge-2',
          asaasPaymentId: 'payment-2',
          asaasValue: 200,
          asaasNetValue: 194,
          asaasFeeValue: 6,
        }),
      ],
      anticipations: [anticipation()],
      asaasInstallmentId: null,
      totalCost: 200,
      hasReturns: false,
      canceled: false,
    });

    expect(result).toMatchObject({
      receivedChargeCount: 2,
      anticipationFeeRecorded: 1,
      totalFeesRecorded: 10,
      netReceivedRecorded: 290,
      profitAfterRecordedFees: 90,
    });
  });

  it('adds tenant-selected nonprocessing fees once and preserves positive reversals', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [charge()],
      anticipations: [],
      additionalFees: [
        {
          asaasTransactionId: 'fee-1',
          paymentId: 'payment-1',
          type: 'PAYMENT_MESSAGING_NOTIFICATION_FEE',
          description: 'Taxa de notificação',
          value: -0.5,
        },
        {
          asaasTransactionId: 'fee-1',
          paymentId: 'payment-1',
          type: 'PAYMENT_MESSAGING_NOTIFICATION_FEE',
          description: 'Duplicada',
          value: -0.5,
        },
        {
          asaasTransactionId: 'reversal-1',
          paymentId: 'payment-1',
          type: 'PAYMENT_MESSAGING_NOTIFICATION_FEE_REVERSAL',
          description: 'Estorno de notificação',
          value: 0.2,
        },
        {
          asaasTransactionId: 'bureau-1',
          paymentId: 'payment-1',
          type: 'CREDIT_BUREAU_REPORT',
          description: 'Consulta cadastral',
          value: -0.25,
        },
        {
          asaasTransactionId: 'processing-1',
          paymentId: 'payment-1',
          type: 'PAYMENT_FEE',
          description: 'Tarifa já calculada pelo líquido',
          value: -3,
        },
      ],
      asaasInstallmentId: null,
      totalCost: 70,
      hasReturns: false,
      canceled: false,
    });

    expect(result.additionalFees).toHaveLength(3);
    expect(result.additionalFeesRecorded).toBe(0.55);
    expect(result.additionalFees[1]?.value).toBe(-0.2);
    expect(result.totalFeesRecorded).toBe(3.55);
    expect(result.netReceivedRecorded).toBe(96.45);
    expect(result.profitAfterRecordedFees).toBe(26.45);
  });

  it('does not treat invalid or inconsistent charge fee snapshots as zero', () => {
    for (const asaasFeeValue of [-3, 4]) {
      const result = computeStoreSaleReceiptFinancials({
        charges: [charge({ asaasFeeValue })],
        anticipations: [],
        asaasInstallmentId: null,
        totalCost: 70,
        hasReturns: false,
        canceled: false,
      });

      expect(result.processingFeeRecorded).toBeNull();
      expect(result.processingFeeComplete).toBe(false);
      expect(result.profitAfterRecordedFees).toBeNull();
    }
  });

  it('withholds final proceeds for pending refunds and chargeback states on settled charges', () => {
    const scenarios = [
      { status: 'REFUND_REQUESTED', realizationStatus: 'PENDING' },
      { status: 'REFUND_IN_PROGRESS', realizationStatus: 'PENDING' },
      { status: 'CHARGEBACK_REQUESTED', realizationStatus: 'SUPPRESSED' },
      { status: 'CHARGEBACK_DISPUTE', realizationStatus: 'SUPPRESSED' },
      { status: 'AWAITING_CHARGEBACK_REVERSAL', realizationStatus: 'SUPPRESSED' },
    ] as const;

    for (const scenario of scenarios) {
      const result = computeStoreSaleReceiptFinancials({
        charges: [charge({ asaasStatus: scenario.status })],
        anticipations: [],
        asaasInstallmentId: null,
        totalCost: 70,
        hasReturns: false,
        canceled: false,
      });

      expect(result.netReceivedRecorded).toBeNull();
      expect(result.profitAfterRecordedFees).toBeNull();
      expect(result.realizationStatus).toBe(scenario.realizationStatus);
      expect(result.processingFeeRecorded).toBe(3);
    }
  });

  it('does not report final proceeds or profit after return, cancellation, or refund', () => {
    const scenarios = [
      { hasReturns: true, canceled: false, charges: [charge()] },
      { hasReturns: false, canceled: true, charges: [charge()] },
      { hasReturns: false, canceled: false, charges: [charge({ status: 'REFUNDED' })] },
    ];

    for (const scenario of scenarios) {
      const result = computeStoreSaleReceiptFinancials({
        ...scenario,
        anticipations: [anticipation()],
        asaasInstallmentId: null,
        totalCost: 70,
      });
      expect(result.netReceivedRecorded).toBeNull();
      expect(result.profitAfterRecordedFees).toBeNull();
      expect(result.realizationStatus).toBe('SUPPRESSED');
    }
  });

  it('withholds net when plan and payment anticipation records overlap ambiguously', () => {
    const result = computeStoreSaleReceiptFinancials({
      charges: [charge()],
      anticipations: [
        anticipation(),
        anticipation({ id: 'plan-attempt', paymentId: null, installmentId: 'installment-1' }),
      ],
      asaasInstallmentId: 'installment-1',
      totalCost: 70,
      hasReturns: false,
      canceled: false,
    });

    expect(result.anticipationStatus).toBe('AMBIGUOUS');
    expect(result.netReceivedRecorded).toBeNull();
    expect(result.profitAfterRecordedFees).toBeNull();
  });
});
