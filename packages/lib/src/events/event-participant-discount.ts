import {
  calculateEventParticipantDiscount as calculateCanonicalEventParticipantDiscount,
  type EventParticipantDiscountType,
} from '@alusa/domain/events';

export type { EventParticipantDiscountType };

export type EventParticipantDiscountResult = {
  originalAmount: number;
  discountAmount: number;
  chargedAmount: number;
};

export function calculateEventParticipantDiscount(input: {
  originalAmount: number;
  discountType?: EventParticipantDiscountType | null;
  discountValue?: number | null;
  quantity?: number;
}): EventParticipantDiscountResult {
  const result = calculateCanonicalEventParticipantDiscount(input);

  return {
    originalAmount: result.grossAmount,
    discountAmount: result.discountAmount,
    chargedAmount: result.netAmount,
  };
}
