import { describe, expect, it } from 'vitest';

import { canRequestEventRefund } from '@/features/events/shared/event-refund-permission';

describe('event refund authorization policy', () => {
  it('matches the financial refund endpoint roles', () => {
    expect(canRequestEventRefund('ADMIN')).toBe(true);
    expect(canRequestEventRefund('financeiro')).toBe(true);
    expect(canRequestEventRefund('RECEPCAO')).toBe(false);
    expect(canRequestEventRefund(undefined)).toBe(false);
  });
});
