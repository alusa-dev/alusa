import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';

import { classifyAsaasResourceOrigin } from './asaas-resource-origin.service';

describe('Asaas resource origin classification transaction (database)', () => {
  it('rolls back classification and inbox completion when the event-resolution audit insert fails', async () => {
    const suffix = randomUUID().replaceAll('-', '');
    const paymentId = `pay-origin-atomic-${suffix}`;
    const conta = await prisma.conta.create({ data: { nome: `Origin atomicity ${suffix}` } });
    let triggerCreated = false;
    let functionCreated = false;

    try {
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id,
        name: `Origin atomicity ${suffix}`,
        type: 'OTHER',
        status: 'ACTIVE',
        startsAt: new Date(),
      } });
      const lot = await prisma.eventTicketLot.create({ data: {
        contaId: conta.id,
        eventId: event.id,
        name: 'Atomicity test lot',
        ticketType: 'OTHER',
        unitPrice: 10,
        quantityTotal: 1,
        status: 'ACTIVE',
      } });
      await prisma.eventTicketSale.create({ data: {
        contaId: conta.id,
        eventId: event.id,
        lotId: lot.id,
        buyerName: 'Atomicity test buyer',
        quantity: 1,
        unitPriceSnapshot: 10,
        totalAmount: 10,
        paymentMethod: 'OTHER',
        status: 'PAID',
        asaasPaymentId: paymentId,
      } });
      const inbox = await prisma.pendingInboxNotification.create({ data: {
        contaId: conta.id,
        kind: 'BILLING_WEBHOOK',
        payload: { asaasPaymentId: paymentId, asaasSubscriptionId: null },
        dedupeKey: `origin-atomicity:${suffix}`,
        status: 'FAILED',
        attempts: 5,
        lastError: 'Entidade local não encontrada após tentativas máximas',
      } });

      const triggerName = `fail_event_origin_audit_${suffix}`;
      const functionName = `fail_event_origin_audit_fn_${suffix}`;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION public."${functionName}"() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."entityId" = '${inbox.id}'
            AND NEW."action" = 'finance.pending_inbox.event_payment_resolved' THEN
            RAISE EXCEPTION 'intentional event inbox audit failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      functionCreated = true;
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE INSERT ON public."AuditLog"
        FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()
      `);
      triggerCreated = true;

      await expect(classifyAsaasResourceOrigin({
        contaId: conta.id,
        resourceType: 'PAYMENT',
        asaasId: paymentId,
        origin: 'ALUSA',
        actorId: 'atomicity-test-admin',
        reason: 'Pagamento da venda do evento',
      })).rejects.toThrow('intentional event inbox audit failure');

      expect(await prisma.asaasResourceOrigin.findFirst({
        where: { contaId: conta.id, resourceType: 'PAYMENT', asaasId: paymentId },
      })).toBeNull();
      expect(await prisma.pendingInboxNotification.findUnique({ where: { id: inbox.id } })).toMatchObject({
        status: 'FAILED',
        lastError: 'Entidade local não encontrada após tentativas máximas',
        processedAt: null,
      });
      expect(await prisma.auditLog.count({
        where: { contaId: conta.id, action: 'finance.asaas_resource_origin.classified' },
      })).toBe(0);
      expect(await prisma.auditLog.count({
        where: {
          contaId: conta.id,
          action: 'finance.pending_inbox.event_payment_resolved',
          entityId: inbox.id,
        },
      })).toBe(0);
    } finally {
      if (triggerCreated) {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "fail_event_origin_audit_${suffix}" ON public."AuditLog"`);
      }
      if (functionCreated) {
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public."fail_event_origin_audit_fn_${suffix}"()`);
      }
      await prisma.conta.deleteMany({ where: { id: conta.id } });
    }
  }, 30_000);
});
