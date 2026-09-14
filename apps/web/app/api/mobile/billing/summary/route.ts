import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getMobileBillingSummaryForActor,
  MobileBillingUnauthorizedError,
} from '@/features/billing/server/mobile-billing.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const querySchema = z.object({
  period: z.enum(['this-month', 'last-30-days']).default('this-month'),
});

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-billing:summary:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const parsed = querySchema.safeParse({
      period: new URL(request.url).searchParams.get('period') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_QUERY', message: 'Período inválido.' } },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const period = parsed.data.period === 'last-30-days' ? 'LAST_30_DAYS' : 'THIS_MONTH';
    const summary = await getMobileBillingSummaryForActor({ userId: actor.userId, contaId: actor.contaId }, period);
    return NextResponse.json({ summary }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) return unauthorized();
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar o resumo das cobranças.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
