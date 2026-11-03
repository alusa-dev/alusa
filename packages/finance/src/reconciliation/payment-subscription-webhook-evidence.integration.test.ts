import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '@alusa/database';
import { resolvePaymentSubscriptionWebhookEvidence } from './payment-subscription-webhook-evidence';

describe('payment subscription webhook evidence (database)', () => {
  it.each(['live', 'archive', 'duplicate', 'ambiguous', 'wrong-parent', 'wrong-event', 'wrong-payload-payment'])('%s evidence uses exact identity across live/archive', async (scenario) => {
    const rollback = new Error('rollback test fixtures');
    await expect(prisma.$transaction(async (tx) => {
      const conta = await tx.conta.create({ data: { nome: `Webhook evidence ${randomUUID()}` } });
      const otherConta = await tx.conta.create({ data: { nome: `Other webhook tenant ${randomUUID()}` } });
      const identity = { contaId: conta.id, paymentId: `pay-${randomUUID()}`, subscriptionId: 'sub-reviewed', causeId: 'evt-[REDACTED]', event: 'PAYMENT_RECEIVED' };
      const data = {
        contaId: conta.id, eventId: 'evt-canonical', evento: identity.event,
        asaasPaymentId: identity.paymentId, recebidoEm: new Date(), status: 'PROCESSADO', tentativas: 1,
        payload: { id: identity.causeId, event: identity.event, payment: { id: identity.paymentId, subscription: identity.subscriptionId } },
      };
      // Same legacy alias in another tenant is never evidence for this account.
      await tx.webhookAsaas.create({ data: { ...data, contaId: otherConta.id, eventId: 'evt-other-tenant' } });
      if (scenario !== 'archive') await tx.webhookAsaas.create({ data });
      if (scenario !== 'live') {
        await tx.webhookAsaasArchive.create({ data: {
          ...data, id: randomUUID(),
          eventId: scenario === 'ambiguous' ? 'evt-other-canonical' : data.eventId,
          evento: scenario === 'wrong-event' ? 'PAYMENT_CREATED' : data.evento,
          payload: { ...data.payload, payment: {
            id: scenario === 'wrong-payload-payment' ? 'pay-other' : identity.paymentId,
            subscription: scenario === 'wrong-parent' ? 'sub-other' : identity.subscriptionId,
          } },
        } });
      }
      const result = await resolvePaymentSubscriptionWebhookEvidence(tx, identity);
      expect(result).toBe(['live', 'archive', 'duplicate'].includes(scenario) ? 'evt-canonical' : null);
      expect(await resolvePaymentSubscriptionWebhookEvidence(tx, { ...identity, paymentId: 'pay-missing' })).toBeNull();
      throw rollback;
    }, { timeout: 10_000 })).rejects.toBe(rollback);
  });
});
