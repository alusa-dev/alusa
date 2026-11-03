import { describe, expect, it, vi } from 'vitest';
import { resolvePaymentSubscriptionWebhookEvidence } from './payment-subscription-webhook-evidence';

const input = { contaId: 'tenant-a', paymentId: 'pay-a', subscriptionId: 'sub-a', causeId: 'evt-[REDACTED]', event: 'PAYMENT_RECEIVED' };
const row = {
  contaId: 'tenant-a', paymentId: 'pay-a', eventId: 'evt-canonical', event: 'PAYMENT_RECEIVED',
  payloadId: input.causeId, payloadEvent: 'PAYMENT_RECEIVED', payloadPaymentId: 'pay-a', subscriptionId: 'sub-a',
};

async function resolve(rows: unknown[], identity = input) {
  const db = { $queryRaw: vi.fn().mockResolvedValue(rows) };
  const result = await resolvePaymentSubscriptionWebhookEvidence(db, identity);
  return { db, result };
}

describe('payment subscription webhook correlation', () => {
  it.each(['live', 'archive'])('accepts one exact legacy alias from %s with its canonical indexed ID', async () => {
    const { result, db } = await resolve([row]);
    expect(result).toBe('evt-canonical');
    const [query, ...values] = db.$queryRaw.mock.calls[0]!;
    const sql = query.join('?');
    expect(sql).toContain('FROM "WebhookAsaas"');
    expect(sql).toContain('FROM "WebhookAsaasArchive"');
    expect(sql.match(/w\."contaId" = \? AND w\."asaasPaymentId" = \?/g)).toHaveLength(2);
    expect(values).toEqual(['tenant-a', 'pay-a', input.causeId, input.causeId, 'tenant-a', 'pay-a', input.causeId, input.causeId]);
  });

  it('accepts a canonical cause even when the stored body ID differs', async () => {
    expect((await resolve([row], { ...input, causeId: 'evt-canonical' })).result).toBe('evt-canonical');
  });

  it('deduplicates the same canonical event across live and archive rows', async () => {
    expect((await resolve([row, { ...row }])).result).toBe('evt-canonical');
  });

  it.each([
    ['canonical events', { ...row, eventId: 'evt-other' }],
    ['parents', { ...row, subscriptionId: 'sub-other' }],
    ['event types', { ...row, event: 'PAYMENT_CREATED', payloadEvent: 'PAYMENT_CREATED' }],
  ])('rejects alias collisions across different %s', async (_label, other) => {
    expect((await resolve([row, other])).result).toBeNull();
  });

  it.each([
    ['tenant', { ...row, contaId: 'tenant-b' }],
    ['indexed payment', { ...row, paymentId: 'pay-other' }],
    ['payload payment', { ...row, payloadPaymentId: 'pay-other' }],
    ['parent', { ...row, subscriptionId: 'sub-other' }],
    ['event', { ...row, event: 'PAYMENT_CREATED' }],
    ['payload event', { ...row, payloadEvent: 'PAYMENT_CREATED' }],
    ['canonical ID absent', { ...row, eventId: null }],
    ['canonical ID blank', { ...row, eventId: ' ' }],
    ['only masked prefix matches', { ...row, payloadId: 'evt-[REDACTED]-other' }],
  ])('rejects non-exact %s evidence', async (_label, invalid) => {
    expect((await resolve([invalid])).result).toBeNull();
  });

  it('rejects missing and over-limit evidence instead of selecting an arbitrary event', async () => {
    expect((await resolve([])).result).toBeNull();
    expect((await resolve(Array.from({ length: 201 }, () => row))).result).toBeNull();
  });
});
