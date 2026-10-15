import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';

import { createBillingWebhookNotification } from './notifications.service';
import { processPendingInboxNotifications } from '../notifications/pending-inbox-notifications';

describe('notifications.service tenant isolation integration', () => {
  it('does not resolve a legacy payment from another tenant and creates the matching tenant notification', async () => {
    const runId = randomUUID();
    const contaIds: string[] = [];

    try {
      const contaA = await prisma.conta.create({
        data: { nome: `Notification A ${runId}`, cpfCnpj: `A${runId.replaceAll('-', '').slice(0, 13)}` },
      });
      contaIds.push(contaA.id);
      const contaB = await prisma.conta.create({
        data: { nome: `Notification B ${runId}`, cpfCnpj: `B${runId.replaceAll('-', '').slice(0, 13)}` },
      });
      contaIds.push(contaB.id);

      const [userA, userB] = await Promise.all([
        prisma.usuario.create({
          data: {
            contaId: contaA.id,
            nome: 'Finance User A',
            email: `notification-a-${runId}@example.test`,
            senhaHash: 'integration-test',
            role: 'ADMIN',
            status: 'ATIVO',
          },
        }),
        prisma.usuario.create({
          data: {
            contaId: contaB.id,
            nome: 'Finance User B',
            email: `notification-b-${runId}@example.test`,
            senhaHash: 'integration-test',
            role: 'ADMIN',
            status: 'ATIVO',
          },
        }),
      ]);

      const alunoA = await prisma.aluno.create({
        data: { contaId: contaA.id, nome: 'Student A', dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      });
      const alunoB = await prisma.aluno.create({
        data: { contaId: contaB.id, nome: 'Student B', dataNasc: new Date('2010-01-01T00:00:00.000Z') },
      });
      const matriculaA = await prisma.matricula.create({
        data: {
          contaId: contaA.id,
          alunoId: alunoA.id,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
          taxaMatricula: 0,
        },
      });
      const matriculaB = await prisma.matricula.create({
        data: {
          contaId: contaB.id,
          alunoId: alunoB.id,
          dataInicio: new Date('2026-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
          taxaMatricula: 0,
        },
      });
      const paymentA = `pay_legacy_a_${runId}`;
      const paymentB = `pay_legacy_b_${runId}`;
      const cobrancaA = await prisma.cobranca.create({
        data: {
          contaId: contaA.id,
          matriculaId: matriculaA.id,
          competenciaInicio: new Date('2026-01-01T00:00:00.000Z'),
          competenciaFim: new Date('2026-01-31T00:00:00.000Z'),
          valor: 100,
          vencimento: new Date('2026-01-10T00:00:00.000Z'),
          formaPagamento: 'PIX',
          status: 'PENDENTE',
          asaasId: paymentA,
        },
      });
      await prisma.cobranca.create({
        data: {
          contaId: contaB.id,
          matriculaId: matriculaB.id,
          competenciaInicio: new Date('2026-01-01T00:00:00.000Z'),
          competenciaFim: new Date('2026-01-31T00:00:00.000Z'),
          valor: 100,
          vencimento: new Date('2026-01-10T00:00:00.000Z'),
          formaPagamento: 'PIX',
          status: 'PENDENTE',
          asaasId: paymentB,
        },
      });

      const eventB = await prisma.schoolEvent.create({
        data: {
          contaId: contaB.id,
          name: `Notification event ${runId}`,
          type: 'PRESENTATION',
          status: 'PLANNING',
          startsAt: new Date('2027-01-01T00:00:00.000Z'),
          hasTickets: true,
        },
      });
      const lotB = await prisma.eventTicketLot.create({
        data: {
          contaId: contaB.id,
          eventId: eventB.id,
          name: `Notification lot ${runId}`,
          ticketType: 'FULL',
          unitPrice: 100,
          quantityTotal: 10,
          quantitySold: 0,
          saleStartsAt: new Date('2026-01-01T00:00:00.000Z'),
          saleEndsAt: new Date('2027-01-01T00:00:00.000Z'),
          status: 'ACTIVE',
        },
      });
      const eventPaymentB = `pay_event_b_${runId}`;
      const saleB = await prisma.eventTicketSale.create({
        data: {
          contaId: contaB.id,
          eventId: eventB.id,
          lotId: lotB.id,
          buyerName: 'Event buyer B',
          quantity: 1,
          unitPriceSnapshot: 100,
          totalAmount: 100,
          paymentMethod: 'MANUAL_PIX',
          asaasPaymentId: eventPaymentB,
        },
      });

      const wrongTenantResult = await createBillingWebhookNotification({
        contaId: contaA.id,
        eventName: 'PAYMENT_OVERDUE',
        asaasPaymentId: paymentB,
      });
      expect(wrongTenantResult).toMatchObject({ outcome: 'entity_missing', notificationId: null });

      const foreignEventResult = await createBillingWebhookNotification({
        contaId: contaA.id,
        eventName: 'PAYMENT_RECEIVED',
        asaasPaymentId: eventPaymentB,
      });
      expect(foreignEventResult).toMatchObject({ outcome: 'entity_missing', notificationId: null });
      expect(await prisma.eventTicketSale.findUniqueOrThrow({ where: { id: saleB.id }, select: { status: true } }))
        .toEqual({ status: 'PENDING' });

      const pendingInboxAcrossTenants = await prisma.pendingInboxNotification.findMany({
        where: { contaId: { in: [contaA.id, contaB.id] } },
        select: { contaId: true, payload: true },
      });
      expect(pendingInboxAcrossTenants).toHaveLength(2);
      expect(pendingInboxAcrossTenants.find((row) => (row.payload as { asaasPaymentId?: string }).asaasPaymentId === paymentB)).toMatchObject({
        contaId: contaA.id,
        payload: { asaasPaymentId: paymentB },
      });

      const notificationForB = await prisma.notification.findMany({
        where: { contaId: contaB.id, sourceId: paymentB },
      });
      const recipientsForB = await prisma.notificationRecipient.findMany({
        where: { contaId: contaB.id, userId: userB.id },
      });
      expect(notificationForB).toHaveLength(0);
      expect(recipientsForB).toHaveLength(0);

      const correctTenantResult = await createBillingWebhookNotification({
        contaId: contaA.id,
        eventName: 'PAYMENT_OVERDUE',
        asaasPaymentId: paymentA,
      });
      expect(correctTenantResult).toMatchObject({ created: true, recipientCount: 1 });

      await prisma.charge.create({
        data: {
          contaId: contaA.id,
          externalReference: `recovered-${runId}`,
          asaasPaymentId: paymentB,
          value: 100,
          dueDate: new Date('2026-01-10T00:00:00.000Z'),
          description: 'Recovered after local sync',
          payerName: 'Responsible A',
          billingType: 'PIX',
        },
      });
      const pendingPayment = await prisma.pendingInboxNotification.findFirstOrThrow({
        where: { contaId: contaA.id, dedupeKey: { contains: paymentB } },
        select: { id: true },
      });
      await prisma.$executeRaw`
        UPDATE "PendingInboxNotification"
        SET "nextRetryAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
        WHERE "id" = ${pendingPayment.id} AND "contaId" = ${contaA.id}
      `;
      const claimableRows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "PendingInboxNotification"
        WHERE "id" = ${pendingPayment.id}
          AND "status" = 'PENDING'::"PendingInboxNotificationStatus"
          AND "nextRetryAt" <= CURRENT_TIMESTAMP AND "attempts" < "maxAttempts"
      `;
      expect(claimableRows).toHaveLength(1);
      expect(await processPendingInboxNotifications({ contaId: contaA.id })).toMatchObject({ attempted: 1, processed: 1, failed: 0 });
      expect(await processPendingInboxNotifications({ contaId: contaA.id })).toMatchObject({ attempted: 0, processed: 0, failed: 0 });
      expect(await prisma.pendingInboxNotification.findFirstOrThrow({
        where: { contaId: contaA.id, dedupeKey: { contains: paymentB } },
        select: { status: true },
      })).toEqual({ status: 'DONE' });
      expect(await prisma.pendingInboxNotification.count({ where: { contaId: contaA.id, dedupeKey: { contains: paymentB } } })).toBe(1);
      expect(await prisma.pendingInboxNotification.count({ where: { contaId: contaA.id, dedupeKey: { contains: eventPaymentB }, status: 'PENDING' } })).toBe(1);
      expect(await prisma.notification.count({ where: { contaId: contaA.id, sourceId: paymentB } })).toBe(1);

      const notificationForA = await prisma.notification.findFirst({
        where: { contaId: contaA.id, entityType: 'Cobranca', entityId: cobrancaA.id },
        include: { recipients: true },
      });
      expect(notificationForA?.contaId).toBe(contaA.id);
      expect(notificationForA?.recipients.map((recipient) => recipient.userId)).toEqual([userA.id]);
    } finally {
      if (contaIds.length > 0) {
        await prisma.pendingInboxNotification.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.notificationDigestEvent.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.notificationRecipient.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.notification.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.auditLog.deleteMany({ where: { contaId: { in: contaIds }, action: 'notification.created' } });
        await prisma.cobranca.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.charge.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.eventTicketSale.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.eventTicketLot.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.schoolEvent.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.matricula.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.aluno.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.usuario.deleteMany({ where: { contaId: { in: contaIds } } });
        await prisma.conta.deleteMany({ where: { id: { in: contaIds } } });
      }
    }
  });
});
