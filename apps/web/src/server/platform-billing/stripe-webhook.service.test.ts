import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  afterCallback: vi.fn<[callback: () => Promise<void>], void>(),
  enqueue: vi.fn(),
  send: vi.fn(),
  constructEvent: vi.fn(),
  drain: vi.fn(),
}));

vi.mock('next/server', () => ({ after: mocks.afterCallback }));
vi.mock('@vercel/queue', () => ({ send: mocks.send }));
vi.mock('@alusa/platform-billing', () => ({
  createPrismaPlatformBillingStore: vi.fn(),
  enqueuePlatformBillingWebhookEvent: mocks.enqueue,
}));
vi.mock('@alusa/stripe', () => ({
  constructStripeWebhookEvent: mocks.constructEvent,
  parseStripeRuntimeConfig: () => ({ environment: 'TEST' }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('./webhook-worker', () => ({ drainStripeWebhookWorker: mocks.drain }));

import { processStripePlatformWebhook } from './stripe-webhook.service';

describe('Stripe webhook queue publishing', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('persists the event before scheduling an idempotent queue publish after the response', async () => {
    const order: string[] = [];
    mocks.constructEvent.mockReturnValue({ id: 'evt_123' });
    mocks.enqueue.mockImplementation(async () => {
      order.push('persist');
      return { eventId: 'evt_123', inboxId: 'inbox_1', status: 'accepted' };
    });
    mocks.afterCallback.mockImplementation((callback) => {
      order.push('schedule');
      void callback();
    });
    mocks.send.mockImplementation(async (_topic, _message, options) => {
      order.push('publish');
      expect(options).toEqual({ idempotencyKey: 'TEST:evt_123' });
    });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLATFORM_BILLING_INLINE_DRAIN', 'false');

    await processStripePlatformWebhook({ rawBody: '{}', signature: 'sig' });

    expect(order).toEqual(['persist', 'schedule', 'publish']);
    expect(mocks.send).toHaveBeenCalledWith(
      'platform-billing-stripe-webhooks',
      { environment: 'TEST', eventId: 'evt_123' },
      { idempotencyKey: 'TEST:evt_123' },
    );
    expect(mocks.drain).not.toHaveBeenCalled();
  });

  it('logs queue publish failures without failing webhook receipt', async () => {
    mocks.constructEvent.mockReturnValue({ id: 'evt_456' });
    mocks.enqueue.mockResolvedValue({ eventId: 'evt_456', inboxId: 'inbox_2', status: 'duplicate' });
    mocks.afterCallback.mockImplementation((callback) => { void callback(); });
    mocks.send.mockRejectedValue(new Error('queue unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PLATFORM_BILLING_INLINE_DRAIN', 'false');

    await expect(processStripePlatformWebhook({ rawBody: '{}', signature: 'sig' })).resolves.toMatchObject({
      result: { eventId: 'evt_456', status: 'duplicate' },
    });
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('queue_publish.failed')));
    expect(consoleError.mock.calls[0]?.[0]).not.toContain('queue unavailable');
    consoleError.mockRestore();
  });
});
