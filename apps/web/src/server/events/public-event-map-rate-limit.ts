import { NextResponse } from 'next/server';

import { ipFromRequest, rateLimitSubject, strictRateLimitAsync } from '@/lib/rate-limit';

export async function enforcePublicEventMapRateLimit(
  request: Request,
  operation: 'reserve' | 'checkout',
  publicSlug: string,
): Promise<NextResponse | null> {
  const subject = await rateLimitSubject(ipFromRequest(request));
  const [perOperation, perSubject] = await Promise.all([
    strictRateLimitAsync(`public:event-map:${operation}:${publicSlug}:${subject}`, operation === 'reserve' ? 30 : 8, 5 * 60_000),
    strictRateLimitAsync(`public:event-map:${operation}:subject:${subject}`, operation === 'reserve' ? 90 : 20, 5 * 60_000),
  ]);
  const limited = [perOperation, perSubject].find((result) => !result.ok);
  if (!limited) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000))) } },
  );
}

export async function enforcePublicEventMapPaymentSyncRateLimit(
  request: Request,
  orderId: string,
): Promise<NextResponse | null> {
  const subject = await rateLimitSubject(ipFromRequest(request));
  const [perOrder, perSubject] = await Promise.all([
    strictRateLimitAsync(`public:event-map-payment-sync:${orderId}:${subject}`, 3, 15 * 60_000),
    strictRateLimitAsync(`public:event-map-payment-sync:subject:${subject}`, 20, 15 * 60_000),
  ]);
  const limited = [perOrder, perSubject].find((result) => !result.ok);
  if (!limited) return null;

  return NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Muitas verificações de pagamento. Aguarde alguns minutos.' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000))) } },
  );
}
