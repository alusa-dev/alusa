import { isMoneyCents } from './money.js';
import type { BillingCycleWindow, MoneyCents } from './types.js';

const MILLISECONDS_PER_DAY = 86_400_000;

export type ProrateMoneyResult =
  | {
      success: true;
      amountCents: MoneyCents;
      activeDays: number;
      cycleDays: number;
    }
  | { success: false; error: 'INVALID_AMOUNT' | 'INVALID_DATE' | 'INVALID_CYCLE' };

function toUtcCivilDay(value: Date | string): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Daily proration using UTC civil dates and a semiopen window. Timezone
 * conversion belongs to the caller; after conversion DST cannot change the
 * number of school billing days.
 */
export function prorateMoneyByDays(input: {
  fullAmountCents: MoneyCents;
  cycle: BillingCycleWindow;
  validFrom: Date | string;
  validUntil?: Date | string | null;
}): ProrateMoneyResult {
  if (!isMoneyCents(input.fullAmountCents)) {
    return { success: false, error: 'INVALID_AMOUNT' };
  }

  const cycleStart = toUtcCivilDay(input.cycle.startsAt);
  const cycleEnd = toUtcCivilDay(input.cycle.endsAt);
  const validFrom = toUtcCivilDay(input.validFrom);
  const validUntil = input.validUntil == null ? null : toUtcCivilDay(input.validUntil);

  if (
    cycleStart == null ||
    cycleEnd == null ||
    validFrom == null ||
    (input.validUntil != null && validUntil == null)
  ) {
    return { success: false, error: 'INVALID_DATE' };
  }

  if (cycleEnd <= cycleStart) {
    return { success: false, error: 'INVALID_CYCLE' };
  }

  if (validUntil != null && validUntil <= validFrom) {
    return { success: false, error: 'INVALID_DATE' };
  }

  const activeStart = Math.max(cycleStart, validFrom);
  const activeEnd = Math.min(cycleEnd, validUntil ?? cycleEnd);
  const cycleDays = (cycleEnd - cycleStart) / MILLISECONDS_PER_DAY;
  const activeDays = Math.max(0, (activeEnd - activeStart) / MILLISECONDS_PER_DAY);

  if (activeDays === 0) {
    return { success: true, amountCents: 0, activeDays, cycleDays };
  }

  const numerator = input.fullAmountCents * activeDays;
  const quotient = Math.floor(numerator / cycleDays);
  const remainder = numerator % cycleDays;
  const amountCents = quotient + (remainder * 2 >= cycleDays ? 1 : 0);

  return { success: true, amountCents, activeDays, cycleDays };
}

