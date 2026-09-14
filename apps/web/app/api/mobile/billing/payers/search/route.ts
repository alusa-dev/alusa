import { NextResponse } from 'next/server';

import { searchFinancePayers } from '@/features/billing/server/finance-payers-search.service';
import { assertMobileBillingActor, MobileBillingUnauthorizedError } from '@/features/billing/server/mobile-billing.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const token = bearerToken(request);
  const verified = token ? await verifyMobileAccessToken(token) : null;
  if (!verified) return errorResponse('UNAUTHORIZED', 'Sessão inválida.', 401);

  const limiter = rateLimit(`mobile-billing:payers:${verified.userId}:${ipFromRequest(request)}`, 60, 10 * 60 * 1000);
  if (!limiter.ok) return errorResponse('RATE_LIMITED', 'Muitas consultas. Aguarde alguns minutos.', 429);

  try {
    await assertMobileBillingActor({ userId: verified.userId, contaId: verified.contaId });
    const result = await searchFinancePayers(verified.contaId, new URL(request.url).searchParams.get('q') ?? '');
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) return errorResponse('FORBIDDEN', 'Você não tem permissão para consultar pagadores.', 403);
    console.error('[mobile-billing][payers-search]', { contaId: verified.contaId, userId: verified.userId, error: error instanceof Error ? error.message : String(error) });
    return errorResponse('SERVER_ERROR', 'Não foi possível buscar os pagadores.', 500);
  }
}
