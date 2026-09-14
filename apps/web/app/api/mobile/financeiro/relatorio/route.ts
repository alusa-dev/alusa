import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getMobileFinancialReport,
  MobileReportUnauthorizedError,
} from '@/features/financeiro/server/mobile-relatorio.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const querySchema = z.object({
  period: z.enum(['this-month', 'previous-month', 'last-3-months']).default('this-month'),
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

  const limiter = rateLimit(`mobile-report:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = querySchema.safeParse({ period: new URL(request.url).searchParams.get('period') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_QUERY', message: 'O período informado não é válido.' } },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const report = await getMobileFinancialReport({
      actor: { userId: actor.userId, contaId: actor.contaId },
      period: parsed.data.period,
    });
    return NextResponse.json(report, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof MobileReportUnauthorizedError) return unauthorized();
    console.error('[API relatório mobile]', error);
    return NextResponse.json(
      { error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar o relatório agora.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
