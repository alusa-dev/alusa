import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';
import { updateCostumeAssignment } from '@alusa/lib/events/events.service';

import { deleteEventCost } from './event-financial-operations';

describe('event cost hard deletion (database)', () => {
  it('does not rematerialize a deleted costume loss cost on a later source update', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Cost deletion ${suffix}` } });

    try {
      const user = await prisma.usuario.create({ data: {
        contaId: conta.id,
        nome: 'Event cost deletion integration',
        email: `event-cost-delete-${suffix}@test.invalid`,
        senhaHash: 'integration-test',
      } });
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id,
        name: `Cost deletion ${suffix}`,
        type: 'OTHER',
        status: 'ACTIVE',
        startsAt: new Date(),
      } });
      const costume = await prisma.eventCostume.create({ data: {
        contaId: conta.id,
        eventId: event.id,
        name: 'Figurino de teste',
        category: 'CLOTHING',
        schoolCost: 100,
        quantity: 1,
      } });
      const assignment = await prisma.eventCostumeAssignment.create({ data: {
        contaId: conta.id,
        eventId: event.id,
        costumeId: costume.id,
        status: 'LOST',
        billingMode: 'FREE',
      } });
      const originId = `loss:${assignment.id}`;
      const cost = await prisma.eventFinancialEntry.create({ data: {
        contaId: conta.id,
        eventId: event.id,
        type: 'COST',
        category: 'Prejuízo',
        description: 'Figurino perdido - Figurino de teste',
        originType: 'COSTUME',
        originId,
        expectedAmount: 100,
        actualAmount: 100,
        status: 'PAID',
        createdByUserId: user.id,
      } });

      await deleteEventCost({ contaId: conta.id, userId: user.id }, cost.id);
      const deletionAudit = await prisma.eventAudit.findFirst({
        where: {
          contaId: conta.id,
          entityId: cost.id,
          action: 'events.finance.cost.delete',
        },
      });
      expect(deletionAudit?.metadata).toMatchObject({ originType: 'COSTUME', originId });
      await updateCostumeAssignment({ contaId: conta.id, userId: user.id }, assignment.id, { notes: 'Atualização após exclusão' });

      expect(await prisma.eventFinancialEntry.findFirst({
        where: { id: cost.id, contaId: conta.id },
      })).toBeNull();
      expect(await prisma.eventFinancialEntry.findFirst({
        where: { contaId: conta.id, eventId: event.id, originType: 'COSTUME', originId },
      })).toBeNull();
      expect(await prisma.eventAudit.findFirst({
        where: {
          contaId: conta.id,
          entityId: cost.id,
          action: 'events.finance.cost.delete',
        },
      })).not.toBeNull();
    } finally {
      await prisma.conta.deleteMany({ where: { id: conta.id } });
    }
  }, 30_000);
});
