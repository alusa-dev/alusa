export type EventParticipantDiscountType = 'FIXED' | 'PERCENTAGE';

export type EventFinancialCostClass = 'DIRECT' | 'INDIRECT' | 'FINANCIAL' | 'TAX';

export type EventFinancialLine = {
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
};

function money(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((Math.max(parsed, 0) + Number.EPSILON) * 100) / 100;
}

export function roundEventMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function supportsEventCostPaymentOrigin(originType: string, originId?: string | null): boolean {
  return originType === 'MANUAL'
    || (originType === 'COSTUME' && Boolean(originId) && !originId?.startsWith('loss:'));
}

export function calculateEventParticipantDiscount(input: {
  originalAmount: number;
  discountType?: EventParticipantDiscountType | null;
  discountValue?: number | null;
  quantity?: number;
}): EventFinancialLine {
  const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));
  const grossAmount = money(input.originalAmount * quantity);
  const discountValue = money(input.discountValue ?? 0);
  const requestedDiscount = input.discountType === 'PERCENTAGE'
    ? money(grossAmount * (discountValue / 100))
    : discountValue;
  const discountAmount = money(Math.min(requestedDiscount, grossAmount));

  return {
    grossAmount,
    discountAmount,
    netAmount: money(grossAmount - discountAmount),
  };
}

export function normalizeEventFinancialLine(input: {
  expectedAmount: number | string | null | undefined;
  grossAmount?: number | string | null;
  discountAmount?: number | string | null;
}): EventFinancialLine {
  const expectedAmount = money(input.expectedAmount);
  const grossAmount = money(input.grossAmount ?? expectedAmount);
  const discountAmount = money(input.discountAmount ?? Math.max(grossAmount - expectedAmount, 0));
  const netAmount = money(grossAmount - discountAmount);

  if (discountAmount > grossAmount) {
    throw new Error('O desconto financeiro não pode ser maior que o valor bruto.');
  }

  if (input.grossAmount != null || input.discountAmount != null) {
    if (Math.abs(netAmount - expectedAmount) > 0.01) {
      throw new Error('O valor esperado deve ser igual ao valor bruto menos o desconto.');
    }
  }

  return { grossAmount, discountAmount, netAmount };
}

export function normalizeEventFinancialPayment(input: {
  actualAmount: number | string | null | undefined;
  refundedAmount?: number | string | null;
  expectedAmount?: number | string | null;
  enforceExpectedLimit?: boolean;
}) {
  const actualAmount = input.actualAmount == null ? null : money(input.actualAmount);
  const refundedAmount = money(input.refundedAmount);

  if (input.enforceExpectedLimit && actualAmount != null && input.expectedAmount != null && actualAmount > money(input.expectedAmount)) {
    throw new Error('O valor recebido não pode ser maior que o valor esperado.');
  }
  if (actualAmount == null && refundedAmount > 0) {
    throw new Error('Não é possível registrar estorno sem valor recebido.');
  }
  if (actualAmount != null && refundedAmount > actualAmount) {
    throw new Error('O estorno não pode ser maior que o valor recebido.');
  }

  return {
    actualAmount,
    refundedAmount,
    netAmount: actualAmount == null ? null : money(actualAmount - refundedAmount),
  };
}

export function calculateEventCostPayment(input: {
  expectedAmount: number | string;
  paidAmount: number | string | null | undefined;
  paymentAmount: number | string;
}) {
  const expectedAmount = money(input.expectedAmount);
  const paidAmount = money(input.paidAmount);
  const paymentAmount = money(input.paymentAmount);
  if (paymentAmount <= 0) throw new Error('O pagamento deve ser maior que zero.');
  const balance = money(Math.max(expectedAmount - paidAmount, 0));
  if (paymentAmount > balance) throw new Error('O pagamento não pode ser maior que o saldo restante.');
  const totalPaid = money(paidAmount + paymentAmount);
  return { balance, totalPaid, remaining: money(balance - paymentAmount), status: totalPaid >= expectedAmount ? 'PAID' as const : 'PARTIALLY_PAID' as const };
}
