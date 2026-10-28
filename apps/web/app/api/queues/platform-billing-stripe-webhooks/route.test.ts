import { describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/queue', () => ({ handleCallback: (handler: (_message: unknown) => Promise<void>) => handler }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/src/server/platform-billing/webhook-worker', () => ({ drainStripeWebhookWorker: vi.fn() }));

import { processStripeWebhookQueueMessage } from './route';

describe('Stripe webhook queue consumer', () => {
  const inboxStatus = (status: string, nextAttemptAt: Date | null = null, processingTimeoutAt: Date | null = null) => ({
    status,
    nextAttemptAt,
    processingTimeoutAt,
  });

  it('drains only the message event and acknowledges processed outcomes', async () => {
    const drain = vi.fn().mockResolvedValue({ failed: 0 });
    const findStatus = vi.fn().mockResolvedValue(inboxStatus('PROCESSED'));

    await expect(processStripeWebhookQueueMessage(
      { environment: 'LIVE', eventId: 'evt_1' },
      { drain, findStatus },
    )).resolves.toBeUndefined();
    expect(drain).toHaveBeenCalledWith({ environment: 'LIVE', eventIds: ['evt_1'] });
    expect(findStatus).toHaveBeenCalledWith({ environment: 'LIVE', eventId: 'evt_1' });
  });

  it.each(['IGNORED', 'EXHAUSTED'])('acknowledges terminal %s outcomes', async (status) => {
    await expect(processStripeWebhookQueueMessage(
      { environment: 'TEST', eventId: 'evt_terminal' },
      { drain: vi.fn().mockResolvedValue({ failed: 0 }), findStatus: vi.fn().mockResolvedValue(inboxStatus(status)) },
    )).resolves.toBeUndefined();
  });

  it.each(['PENDING', 'RECEIVED', 'PROCESSING', 'FAILED', null])('retries due nonterminal %s outcomes', async (status) => {
    await expect(processStripeWebhookQueueMessage(
      { environment: 'TEST', eventId: 'evt_retry' },
      {
        drain: vi.fn().mockResolvedValue({ failed: status === 'FAILED' ? 1 : 0 }),
        findStatus: vi.fn().mockResolvedValue(status ? inboxStatus(status) : null),
      },
    )).rejects.toThrow();
  });

  it('acknowledges inbox retries already scheduled with durable backoff', async () => {
    const retryAt = new Date(Date.now() + 5 * 60_000);
    await expect(processStripeWebhookQueueMessage(
      { environment: 'TEST', eventId: 'evt_backoff' },
      {
        drain: vi.fn().mockResolvedValue({ failed: 1 }),
        findStatus: vi.fn().mockResolvedValue(inboxStatus('FAILED', retryAt)),
      },
    )).resolves.toBeUndefined();
  });

  it('acknowledges an active lease until its processing timeout', async () => {
    await expect(processStripeWebhookQueueMessage(
      { environment: 'TEST', eventId: 'evt_lease' },
      {
        drain: vi.fn().mockResolvedValue({ failed: 0 }),
        findStatus: vi.fn().mockResolvedValue(inboxStatus('PROCESSING', null, new Date(Date.now() + 60_000))),
      },
    )).resolves.toBeUndefined();
  });

  it('rejects invalid queue payloads', async () => {
    await expect(processStripeWebhookQueueMessage(
      { environment: 'OTHER', eventId: '' },
      { drain: vi.fn(), findStatus: vi.fn() },
    )).rejects.toThrow();
  });
});
