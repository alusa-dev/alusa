import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';
import { createManualEventParticipantPayment } from './event-financial-operations';

describe('event participant payment serialization (database)', () => {
  it('serializes duplicate keys across participants, prevents overpayment, and scopes mutations to the tenant', async () => {
    const suffix = randomUUID();
    const contaA = await prisma.conta.create({ data: { nome: `Event payment ${suffix}` } });
    const contaB = await prisma.conta.create({ data: { nome: `Event payment other ${suffix}` } });

    try {
      const user = await prisma.usuario.create({ data: {
        contaId: contaA.id,
        nome: 'Event payment integration',
        email: `event-payment-${suffix}@test.invalid`,
        senhaHash: 'integration-test',
      } });
      const event = await prisma.schoolEvent.create({ data: {
        contaId: contaA.id,
        name: `Event payment ${suffix}`,
        type: 'OTHER',
        status: 'ACTIVE',
        startsAt: new Date(),
      } });
      const [participantA, participantB] = await Promise.all(['A', 'B'].map((label) => prisma.eventParticipant.create({
        data: {
          contaId: contaA.id,
          eventId: event.id,
          type: 'GUEST',
          displayName: label,
          registrationFeeCharged: 100,
          registrationFeeOriginal: 100,
          balanceAmount: 100,
        },
      })));
      const ctx = { contaId: contaA.id, userId: user.id };
      const key = randomUUID();
      const sameKeyResults = await Promise.allSettled([
        createManualEventParticipantPayment(ctx, event.id, participantA.id, { idempotencyKey: key, amount: 10, paymentMethod: 'CASH' }),
        createManualEventParticipantPayment(ctx, event.id, participantB.id, { idempotencyKey: key, amount: 10, paymentMethod: 'CASH' }),
      ]);

      expect(sameKeyResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const winnerIndex = sameKeyResults.findIndex((result) => result.status === 'fulfilled');
      const paidParticipant = winnerIndex === 0 ? participantA : participantB;
      const duplicateKeyFailure = sameKeyResults.find((result) => result.status === 'rejected');
      expect(duplicateKeyFailure).toMatchObject({ status: 'rejected', reason: { code: 'IDEMPOTENCY_KEY_REUTILIZADA', status: 409 } });
      expect(await prisma.eventFinancialPayment.count({ where: { contaId: contaA.id, idempotencyKey: key } })).toBe(1);

      const overpayResults = await Promise.allSettled([
        createManualEventParticipantPayment(ctx, event.id, paidParticipant.id, { idempotencyKey: randomUUID(), amount: 60, paymentMethod: 'CASH' }),
        createManualEventParticipantPayment(ctx, event.id, paidParticipant.id, { idempotencyKey: randomUUID(), amount: 60, paymentMethod: 'CASH' }),
      ]);
      expect(overpayResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(overpayResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const persistedPayments = await prisma.eventFinancialPayment.findMany({
        where: { contaId: contaA.id, participantId: paidParticipant.id },
      });
      expect(persistedPayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0)).toBe(70);

      await expect(createManualEventParticipantPayment({ contaId: contaB.id, userId: user.id }, event.id, participantA.id, {
        idempotencyKey: randomUUID(), amount: 1, paymentMethod: 'CASH',
      })).rejects.toMatchObject({ code: 'INSCRICAO_NAO_ENCONTRADA', status: 404 });
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [contaA.id, contaB.id] } } });
    }
  }, 30_000);
});
