import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import { prisma } from '@/lib/prisma';

export async function findStripeWebhookQueueEventStatus(input: {
  environment: PlatformBillingEnvironment;
  eventId: string;
}) {
  const event = await prisma.platformBillingWebhookEvent.findUnique({
    where: { uq_platform_billing_webhook_env_event: input },
    select: { status: true, nextAttemptAt: true, processingTimeoutAt: true },
  });
  return event ?? null;
}
