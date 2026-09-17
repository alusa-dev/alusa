import {
  createPrismaPlatformBillingStore,
  enqueuePlatformBillingWebhookEvent,
} from '@alusa/platform-billing';
import { constructStripeWebhookEvent, parseStripeRuntimeConfig } from '@alusa/stripe';
import { prisma } from '@/lib/prisma';
import { drainStripeWebhookWorker } from './webhook-worker';

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
  const drainResult = shouldDrainStripeWebhooksInline()
    ? await drainStripeWebhookWorker({
        prisma,
        limit: 10,
        environment: config.environment,
        workerId: 'stripe-webhook-inline-drain',
      })
    : null;
  return { config, result, drainResult };
}

function shouldDrainStripeWebhooksInline(): boolean {
  const configured = process.env.PLATFORM_BILLING_INLINE_DRAIN?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
