import { NextResponse } from 'next/server';

import { ipFromRequest, rateLimitSubject, strictRateLimitAsync } from '@/lib/rate-limit';

const PUBLIC_EVENT_MAP_RATE_LIMIT_WINDOW_MS = 5 * 60_000;

// These coarse per-subject ceilings are a starting point for isolated Preview
// validation. They are not proof that >500 complete purchase journeys are
// supported; seat ownership and checkout idempotency remain the integrity
// controls.
const PUBLIC_EVENT_MAP_RATE_LIMITS = {
  reserve: { perSubject: 1_500 },
  checkout: { perSubject: 1_500 },
  orderStatus: { perOrder: 60, perSubject: 15_000 },
  paymentSync: { perSubject: 20 },
} as const;

async function publicEventMapRateLimitSubject(request: Request) {
  const source = ipFromRequest(request);
  // `ipFromRequest` falls back to User-Agent + language when proxy headers are
  // not trusted. Those values are client-controlled, so anonymous ticketing
  // routes collapse that case into one fixed bucket instead of allowing
  // arbitrary Redis key creation/header rotation. This can collectively rate
  // limit legitimate buyers until trusted proxy headers are configured.
  return rateLimitSubject(source.startsWith('ua:') ? 'public-event-map:untrusted-origin' : source);
}

export async function enforcePublicEventMapRateLimit(
  request: Request,
  operation: 'reserve' | 'checkout',
): Promise<NextResponse | null> {
  const subject = await publicEventMapRateLimitSubject(request);
  const result = await strictRateLimitAsync(
    `public:event-map:${operation}:subject:${subject}`,
    PUBLIC_EVENT_MAP_RATE_LIMITS[operation].perSubject,
    PUBLIC_EVENT_MAP_RATE_LIMIT_WINDOW_MS,
  );
  if (result.ok) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) } },
  );
}

export async function enforcePublicEventMapPaymentSyncRateLimit(
  request: Request,
): Promise<NextResponse | null> {
  const subject = await publicEventMapRateLimitSubject(request);
  const result = await strictRateLimitAsync(
    `public:event-map-payment-sync:subject:${subject}`,
    PUBLIC_EVENT_MAP_RATE_LIMITS.paymentSync.perSubject,
    15 * 60_000,
  );
  if (result.ok) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas verificações de pagamento. Aguarde alguns minutos.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) } },
  );
}

/**
 * Status polling is local-only and exponentially backs off in the browser.
 * The shared-origin bucket runs before the order/token lookup and never uses
 * an untrusted order ID in its key. The per-order bucket runs only after the
 * caller has proved possession of that order's access token.
 */
export async function enforcePublicEventMapOrderStatusSubjectRateLimit(request: Request): Promise<NextResponse | null> {
  const subject = await publicEventMapRateLimitSubject(request);
  const limits = PUBLIC_EVENT_MAP_RATE_LIMITS.orderStatus;
  const result = await strictRateLimitAsync(
    `public:event-map-order-status-subject:${subject}`,
    limits.perSubject,
    PUBLIC_EVENT_MAP_RATE_LIMIT_WINDOW_MS,
  );
  if (result.ok) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas consultas de status. Aguarde alguns instantes.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) } },
  );
}

export async function enforcePublicEventMapOrderStatusRateLimit(
  request: Request,
  orderId: string,
): Promise<NextResponse | null> {
  const subject = await publicEventMapRateLimitSubject(request);
  const result = await strictRateLimitAsync(
    `public:event-map-order-status:${orderId}:${subject}`,
    PUBLIC_EVENT_MAP_RATE_LIMITS.orderStatus.perOrder,
    PUBLIC_EVENT_MAP_RATE_LIMIT_WINDOW_MS,
  );
  if (result.ok) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas consultas de status. Aguarde alguns instantes.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))) } },
  );
}
