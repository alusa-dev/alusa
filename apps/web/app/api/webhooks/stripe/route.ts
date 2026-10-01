import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { processStripePlatformWebhook } from '@/src/server/platform-billing/stripe-webhook.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export const runtime = 'nodejs';

const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const rate = await rateLimitAsync(`platform-billing:stripe-webhook:${requestIp}`, 600, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
      },
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

    const { result, drainResult } = await processStripePlatformWebhook({
      rawBody,
      signature: req.headers.get('stripe-signature'),
    });

    logApiOperationalEvent({
      severity: 'info',
      eventName:
        result.status === 'duplicate'
          ? 'api.platform_billing.stripe_webhook.duplicate'
          : 'api.platform_billing.stripe_webhook.received',
      route: '/api/webhooks/stripe',
      method: 'POST',
      requestId: getRequestId(req),
    });

    if (drainResult) {
      logApiOperationalEvent({
        severity: drainResult.failed > 0 || drainResult.exhausted > 0 ? 'warn' : 'info',
        eventName: 'api.platform_billing.stripe_webhook.inline_drain.completed',
        route: '/api/webhooks/stripe',
        method: 'POST',
        requestId: getRequestId(req),
        processedCount: drainResult.processed,
        failedCount: drainResult.failed,
        exhaustedCount: drainResult.exhausted,
        ignoredCount: drainResult.ignored,
        outcome:
          drainResult.failed > 0 || drainResult.exhausted > 0 ? 'partial_failure' : 'success',
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

    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.platform_billing.stripe_webhook.request.failed',
      route: '/api/webhooks/stripe',
      method: 'POST',
      requestId: getRequestId(req),
      error,
    });
    return NextResponse.json({ error: 'PLATFORM_BILLING_WEBHOOK_FAILED' }, { status: 500 });
  }
}
