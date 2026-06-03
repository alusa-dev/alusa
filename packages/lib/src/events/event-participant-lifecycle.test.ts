import { describe, expect, it } from 'vitest';

import { canRemoveEventParticipant } from './event-participant-lifecycle';

describe('canRemoveEventParticipant', () => {
  it('allows removing a cancelled participant without operational history', () => {
    expect(canRemoveEventParticipant({
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      isFeePaid: false,
      feePaidAmount: 0,
      feeRefundedAmount: 0,
      financialEntries: [{ status: 'CANCELLED', actualAmount: null, refundedAmount: 0, netAmount: null }],
      charges: [{ status: 'CANCELED' }],
      ticketSales: [],
      costumeAssignments: [],
    })).toEqual({ canRemove: true, reasons: [] });
  });

  it('blocks removal when the participant has received payment', () => {
    const decision = canRemoveEventParticipant({
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      financialEntries: [{ status: 'RECEIVED', actualAmount: 100, refundedAmount: 0, netAmount: 100 }],
    });

    expect(decision.canRemove).toBe(false);
    expect(decision.reasons).toContain('Este participante possui lançamento financeiro realizado.');
  });

  it('blocks removal when the participant has a refund', () => {
    const decision = canRemoveEventParticipant({
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      feeRefundedAmount: 20,
      charges: [{ status: 'REFUNDED' }],
    });

    expect(decision.canRemove).toBe(false);
    expect(decision.reasons).toContain('Este participante possui estorno registrado.');
    expect(decision.reasons).toContain('Este participante possui cobrança com pagamento ou estorno registrado.');
  });

  it('blocks removal when the participant has delivered costume history', () => {
    const decision = canRemoveEventParticipant({
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      costumeAssignments: [{ status: 'DELIVERED', isPaid: false }],
    });

    expect(decision.canRemove).toBe(false);
    expect(decision.reasons).toContain('Este participante possui figurino vinculado.');
  });

  it('blocks removal when the participant has issued ticket or confirmed public order history', () => {
    const decision = canRemoveEventParticipant({
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      tickets: [{ status: 'VALID' }],
      publicOrders: [{ status: 'CONFIRMED', ticketsCount: 1 }],
    });

    expect(decision.canRemove).toBe(false);
    expect(decision.reasons).toContain('Este participante possui ingresso emitido.');
    expect(decision.reasons).toContain('Este participante possui pedido público confirmado ou pendente.');
  });

  it('allows removal with cancelled unpaid charges and cancelled financial entries', () => {
    expect(canRemoveEventParticipant({
      cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
      financialEntries: [{ status: 'CANCELLED', actualAmount: null, refundedAmount: 0, netAmount: null }],
      charges: [{ status: 'CANCELED' }, { status: 'CANCELED' }],
    })).toEqual({ canRemove: true, reasons: [] });
  });
});
