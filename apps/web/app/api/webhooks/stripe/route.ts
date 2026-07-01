import { NextRequest, NextResponse } from 'next/server';
import {
  StripeIntegrationError,
  constructStripeWebhookEvent,
  parseStripeRuntimeConfig,
} from '@alusa/stripe';
import { createPrismaPlatformBillingStore, enqueuePlatformBillingWebhookEvent } from '@alusa/platform-billing';
import prisma from '@/lib/prisma';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';

export const runtime = 'nodejs';

const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const rate = await rateLimitAsync(`platform-billing:stripe-webhook:${requestIp}`, 600, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'WEBHOOK_BODY_TOO_LARGE' }, { status: 413 });
  }

  try {
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: 'WEBHOOK_BODY_TOO_LARGE' }, { status: 413 });
    }

    const event = constructStripeWebhookEvent({
      rawBody,
      signature: req.headers.get('stripe-signature'),
      source: process.env,
    });
    const config = parseStripeRuntimeConfig(process.env);
    const result = await enqueuePlatformBillingWebhookEvent(
      {
        event,
        environment: config.environment,
        envSource: process.env,
      },
      createPrismaPlatformBillingStore(prisma),
    );

    console.info('[platform-billing][stripe-webhook]', {
      event: result.status === 'duplicate' ? 'webhook_duplicate' : 'webhook_received',
      eventId: result.eventId,
      eventType: result.eventType,
      inboxId: result.inboxId,
      environment: config.environment,
    });

    if (shouldDrainStripeWebhooksInline()) {
      const drainResult = await drainStripeWebhookWorker({
        prisma,
        limit: 10,
        environment: config.environment,
        workerId: 'stripe-webhook-inline-drain',
      });
      console.info('[platform-billing][stripe-webhook]', {
        event: 'webhook_inline_drain_completed',
        eventId: result.eventId,
        inboxId: result.inboxId,
        ...drainResult,
      });
    }

    return NextResponse.json({
      received: true,
      status: result.status,
      eventId: result.eventId,
      inboxId: result.inboxId,
    });
  } catch (error) {
    if (error instanceof StripeIntegrationError) {
      const status =
        error.code === 'STRIPE_WEBHOOK_SIGNATURE_MISSING' ||
        error.code === 'STRIPE_WEBHOOK_SIGNATURE_INVALID'
          ? 400
          : 500;
      return NextResponse.json({ error: error.code }, { status });
    }

    console.error('[platform-billing][stripe-webhook]', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'PLATFORM_BILLING_WEBHOOK_FAILED' }, { status: 500 });
  }
}

function shouldDrainStripeWebhooksInline(): boolean {
  const configured = process.env.PLATFORM_BILLING_INLINE_DRAIN?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
