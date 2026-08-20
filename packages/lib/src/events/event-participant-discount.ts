export type EventParticipantDiscountType = 'FIXED' | 'PERCENTAGE';

export type EventParticipantDiscountResult = {
  originalAmount: number;
  discountAmount: number;
  chargedAmount: number;
};

function money(value: number) {
  return Math.round((Math.max(value, 0) + Number.EPSILON) * 100) / 100;
}

export function calculateEventParticipantDiscount(input: {
  originalAmount: number;
  discountType?: EventParticipantDiscountType | null;
  discountValue?: number | null;
}): EventParticipantDiscountResult {
  const originalAmount = money(input.originalAmount);
  const discountValue = money(input.discountValue ?? 0);
  const requestedDiscount = input.discountType === 'PERCENTAGE'
    ? money(originalAmount * (discountValue / 100))
    : discountValue;
  const discountAmount = money(Math.min(requestedDiscount, originalAmount));

  return {
    originalAmount,
    discountAmount,
    chargedAmount: money(originalAmount - discountAmount),
  };
}
