import {
  createPrismaPlatformBillingStore,
  enqueuePlatformBillingWebhookEvent,
} from '@alusa/platform-billing';
import { send } from '@vercel/queue';
import { after } from 'next/server';
import { constructStripeWebhookEvent, parseStripeRuntimeConfig } from '@alusa/stripe';
import { prisma } from '@/lib/prisma';
import { drainStripeWebhookWorker } from './webhook-worker';

export const PLATFORM_BILLING_STRIPE_WEBHOOK_TOPIC = 'platform-billing-stripe-webhooks';

export type PlatformBillingStripeWebhookQueueMessage = {
  environment: ReturnType<typeof parseStripeRuntimeConfig>['environment'];
  eventId: string;
};

export async function processStripePlatformWebhook(input: {
  rawBody: string;
  signature: string | null;
}) {
  const event = constructStripeWebhookEvent({
    rawBody: input.rawBody,
    signature: input.signature,
    source: process.env,
  });
  const config = parseStripeRuntimeConfig(process.env);
  const result = await enqueuePlatformBillingWebhookEvent(
    { event, environment: config.environment, envSource: process.env },
    createPrismaPlatformBillingStore(prisma),
  );
  scheduleStripeWebhookQueueDelivery({ environment: config.environment, eventId: result.eventId });
  const drainResult = shouldDrainStripeWebhooksInline()
    ? await drainStripeWebhookWorker({
        prisma,
        limit: 10,
        environment: config.environment,
      })
    : null;
  return { config, result, drainResult };
}

export function scheduleStripeWebhookQueueDelivery(message: PlatformBillingStripeWebhookQueueMessage) {
  after(async () => {
    try {
      await send(PLATFORM_BILLING_STRIPE_WEBHOOK_TOPIC, message, {
        idempotencyKey: `${message.environment}:${message.eventId}`,
      });
    } catch (error) {
      console.error(JSON.stringify({
        severity: 'error',
        eventName: 'api.platform_billing.stripe_webhook.queue_publish.failed',
        route: '/api/webhooks/stripe',
        environment: message.environment,
        eventId: message.eventId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
    }
  });
}

function shouldDrainStripeWebhooksInline(): boolean {
  const configured = process.env.PLATFORM_BILLING_INLINE_DRAIN?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
