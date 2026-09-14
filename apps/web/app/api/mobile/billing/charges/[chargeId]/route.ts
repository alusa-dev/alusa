import { NextResponse } from 'next/server';

import {
  getMobileBillingCharge,
  MobileBillingUnauthorizedError,
} from '@/features/billing/server/mobile-billing.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

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

export async function GET(request: Request, context: { params: Promise<{ chargeId: string }> }) {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  if (!actor) return unauthorized();

  const limiter = rateLimit(`mobile-billing:charge:${actor.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const { chargeId } = await context.params;
    const charge = await getMobileBillingCharge({ userId: actor.userId, contaId: actor.contaId }, chargeId);
    if (!charge) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Cobrança não encontrada.' } },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json({ charge }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) return unauthorized();
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar a cobrança.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
