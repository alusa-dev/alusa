import { describe, expect, it } from 'vitest';

import { getTicketSaleTone } from '@/features/events/tickets/ticket-sale-ui';

describe('ticket sale badge tones', () => {
  it('uses the same semantic colors as online orders', () => {
    expect(getTicketSaleTone('RESERVED')).toBe('warning');
    expect(getTicketSaleTone('PENDING')).toBe('warning');
    expect(getTicketSaleTone('PAID')).toBe('success');
    expect(getTicketSaleTone('CANCELLED')).toBe('neutral');
    expect(getTicketSaleTone('REFUNDED')).toBe('info');
    expect(getTicketSaleTone('COMPLIMENTARY')).toBe('info');
  });
});
