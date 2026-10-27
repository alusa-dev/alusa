import { describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEvent } from '@alusa/stripe';
import { completeTrialCardSetup, expireTrialCardSetup } from './trial-card-setup-webhook';

const metadata = {
  contaId: 'conta-a', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method',
  consentVersion: 'consent-v1', consentAcceptedAt: '2026-10-27T12:00:00.000Z', consentRequestKey: 'req-a',
};
const event = {
  id: 'evt-setup-a', type: 'checkout.session.completed',
  data: { object: { id: 'cs_setup_a', mode: 'setup', status: 'complete', customer: 'cus_a',
    client_reference_id: 'conta-a', metadata } },
} as unknown as StripeWebhookEvent;
const expiredEvent = {
  id: 'evt-setup-expired-a', type: 'checkout.session.expired',
  data: { object: { id: 'cs_setup_a', mode: 'setup', status: 'expired', customer: 'cus_a',
    client_reference_id: 'conta-a', metadata } },
} as unknown as StripeWebhookEvent;

function fixture(overrides?: { intentStatus?: string; consent?: Record<string, unknown> | null }) {
  const calls = { update: vi.fn(async (id: string) => ({ id, allow_redisplay: 'always' })), record: vi.fn() };
  const stripe = {
    retrieveSession: vi.fn(async () => ({ ...event.data.object, setup_intent: 'seti_a' })),
    retrieveSetupIntent: vi.fn(async () => ({ id: 'seti_a', status: overrides?.intentStatus ?? 'succeeded',
      customer: 'cus_a', metadata, payment_method: { id: 'pm_a', object: 'payment_method', type: 'card',
        customer: 'cus_a', card: { brand: 'visa', last4: '4242', exp_month: 6, exp_year: 2028 } } })),
    allowPaymentMethodRedisplay: calls.update,
  };
  const loadConsent = vi.fn(async () => overrides?.consent === null ? null : ({
    accountId: 'billing-a', stripeCustomerId: 'cus_a', consentVersion: 'consent-v1',
    acceptedAt: metadata.consentAcceptedAt, sessionId: 'cs_setup_a',
    alreadyCompleted: false,
    ...overrides?.consent,
  }));
  return { calls, stripe, loadConsent };
}

describe('completeTrialCardSetup', () => {
  it('updates only redisplay after matching successful setup and consent', async () => {
    const f = fixture();
    await completeTrialCardSetup({ event, environment: 'TEST', ...f, record: f.calls.record });
    expect(f.calls.update).toHaveBeenCalledWith('pm_a');
    expect(f.calls.record).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a', accountId: 'billing-a', paymentMethodId: 'pm_a',
      card: { brand: 'visa', last4: '4242', expMonth: 6, expYear: 2028 },
    }));
    expect(Object.keys(f.stripe)).toEqual(['retrieveSession', 'retrieveSetupIntent', 'allowPaymentMethodRedisplay']);
  });

  it('does not repeat the provider update after an idempotent completed record', async () => {
    const f = fixture({ consent: { alreadyCompleted: true } });
    await completeTrialCardSetup({ event, environment: 'TEST', ...f, record: f.calls.record });
    expect(f.calls.update).not.toHaveBeenCalled();
    expect(f.calls.record).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched tenant consent before updating the PaymentMethod', async () => {
    const f = fixture({ consent: null });
    await expect(completeTrialCardSetup({ event, environment: 'TEST', ...f, record: f.calls.record })).rejects.toThrow(/consent/i);
    expect(f.calls.update).not.toHaveBeenCalled();
    expect(f.calls.record).not.toHaveBeenCalled();
  });

  it('rejects an incomplete SetupIntent and never records a saved card', async () => {
    const f = fixture({ intentStatus: 'processing' });
    await expect(completeTrialCardSetup({ event, environment: 'TEST', ...f, record: f.calls.record })).rejects.toThrow(/SetupIntent/i);
    expect(f.calls.update).not.toHaveBeenCalled();
    expect(f.calls.record).not.toHaveBeenCalled();
  });
});

describe('expireTrialCardSetup', () => {
  it('records a verified expiration when no local session audit was required', async () => {
    const record = vi.fn();
    const loadConsent = vi.fn(async () => ({ accountId: 'billing-a', stripeCustomerId: 'cus_a',
      consentVersion: 'consent-v1', acceptedAt: metadata.consentAcceptedAt, sessionId: 'cs_setup_a', alreadyCompleted: false }));
    const retrieveSession = vi.fn(async () => ({ ...expiredEvent.data.object }));

    await expireTrialCardSetup({ event: expiredEvent, environment: 'TEST', retrieveSession, loadConsent, record });

    expect(retrieveSession).toHaveBeenCalledWith('cs_setup_a');
    expect(loadConsent).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', customerId: 'cus_a', requestKey: 'req-a' }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', accountId: 'billing-a', sessionId: 'cs_setup_a' }));
  });

  it('does not release another tenant claim when consent does not match', async () => {
    const record = vi.fn();
    await expect(expireTrialCardSetup({
      event: expiredEvent, environment: 'TEST', retrieveSession: async () => ({ ...expiredEvent.data.object }),
      loadConsent: async () => null, record,
    })).rejects.toThrow(/consent/i);
    expect(record).not.toHaveBeenCalled();
  });
});
