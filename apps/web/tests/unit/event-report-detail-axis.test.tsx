import { describe, expect, it } from 'vitest';

import { getEventTimelineCurrencyAxis } from '../../features/events/reports/EventReportDetail';

describe('getEventTimelineCurrencyAxis', () => {
  it('keeps zero in the scale and handles empty or zero-only timelines', () => {
    expect(getEventTimelineCurrencyAxis(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(getEventTimelineCurrencyAxis(Math.max(0, ...[]))).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('chooses readable ticks above the former fixed chart ceiling', () => {
    const axis = getEventTimelineCurrencyAxis(12_345);

    expect(axis.max).toBeGreaterThan(12_345);
    expect(axis.max).toBeGreaterThan(500);
    expect(axis.ticks[0]).toBe(0);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max);
    expect(axis.ticks.every((tick, index) => index === 0 || tick > axis.ticks[index - 1])).toBe(true);
  });
});
