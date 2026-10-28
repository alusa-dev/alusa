import { handleCallback } from '@vercel/queue';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import { drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';

export const runtime = 'nodejs';

const queueMessageSchema = z.object({
  environment: z.enum(['TEST', 'LIVE']),
  eventId: z.string().min(1).max(255),
}).strict();

export async function processStripeWebhookQueueMessage(
  rawMessage: unknown,
  dependencies: {
    drain: (_input: { environment: PlatformBillingEnvironment; eventIds: string[] }) => Promise<{
      failed: number;
    }>;
    findStatus: (_input: { environment: PlatformBillingEnvironment; eventId: string }) => Promise<{
      status: string;
      nextAttemptAt: Date | null;
      processingTimeoutAt: Date | null;
    } | null>;
  } = {
    drain: ({ environment, eventIds: _eventIds }) => drainStripeWebhookWorker({ environment, eventIds: _eventIds }),
    findStatus: async ({ environment, eventId: _eventId }) => {
      const event = await prisma.platformBillingWebhookEvent.findUnique({
        where: { uq_platform_billing_webhook_env_event: { environment, eventId: _eventId } },
        select: { status: true, nextAttemptAt: true, processingTimeoutAt: true },
      });
      return event ?? null;
    },
  },
): Promise<void> {
  const message = queueMessageSchema.parse(rawMessage);
  const drainResult = await dependencies.drain({
    environment: message.environment,
    eventIds: [message.eventId],
  });
  const inbox = await dependencies.findStatus(message);
  const status = inbox?.status ?? null;

  if (status === 'PROCESSED' || status === 'IGNORED' || status === 'EXHAUSTED') return;
  const now = Date.now();
  if (
    inbox && (
      (status !== 'PROCESSING' && inbox.nextAttemptAt && inbox.nextAttemptAt.getTime() > now)
      || (status === 'PROCESSING' && inbox.processingTimeoutAt && inbox.processingTimeoutAt.getTime() > now)
    )
  ) return;
  if (drainResult.failed > 0 || status === 'FAILED' || status === 'PROCESSING' || status === 'PENDING' || status === 'RECEIVED') {
    throw new Error(`Stripe webhook ${message.eventId} remains retryable (${status ?? 'missing'})`);
  }
  throw new Error(`Stripe webhook ${message.eventId} has no terminal inbox outcome (${status ?? 'missing'})`);
}

export const POST = handleCallback<unknown>(async (message) => {
  await processStripeWebhookQueueMessage(message);
});
