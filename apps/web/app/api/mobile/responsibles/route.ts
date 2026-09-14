import { NextResponse } from 'next/server';
import { z } from 'zod';

import { listMobileResponsibles, MobileResponsibleUnauthorizedError } from '@/features/responsibles/server/mobile-responsibles.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

function token(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  return value?.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() || null : null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const actor = await verifyMobileAccessToken(token(request) ?? '');
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  const search = new URL(request.url).searchParams;
  const parsed = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL') }).safeParse({ q: search.get('q') ?? undefined, status: search.get('status') ?? undefined });
  if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: 'Filtro inválido.' } }, 422);
  try {
    return response(await listMobileResponsibles({ userId: actor.userId, contaId: actor.contaId, query: parsed.data.q, status: parsed.data.status }));
  } catch (error) {
    if (error instanceof MobileResponsibleUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    console.error('[mobile-responsibles][list]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar os responsáveis.' } }, 500);
  }
}
