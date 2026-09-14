import { NextResponse } from 'next/server';

import { saveAttendanceInputSchema } from '@/features/aulas/dtos';
import {
  getMobileAttendanceDetails,
  MobileAgendaForbiddenError,
  MobileAgendaNotFoundError,
  MobileAgendaUnauthorizedError,
  saveMobileAttendance,
} from '@/features/aulas/server/mobile-agenda.service';
import { knownMobileAgendaError } from '@/features/aulas/server/mobile-agenda-route-utils';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function authenticate(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

function authError(error: unknown) {
  if (error instanceof MobileAgendaUnauthorizedError) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (error instanceof MobileAgendaNotFoundError) return response({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
  if (error instanceof MobileAgendaForbiddenError) return response({ error: { code: 'FORBIDDEN', message: error.message } }, 403);
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);

  const limiter = rateLimit(`mobile-attendance:detail:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) return response({ error: { code: 'RATE_LIMITED', message: 'Muitas consultas. Aguarde alguns minutos.' } }, 429);

  try {
    const { eventId } = await context.params;
    return response(await getMobileAttendanceDetails({ userId: actor.userId, contaId: actor.contaId }, eventId));
  } catch (error) {
    const knownError = knownMobileAgendaError(error);
    if (knownError) return response(knownError.body, knownError.status);
    const handled = authError(error);
    if (handled) return handled;
    console.error('[mobile-attendance][detail]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar a frequência.' } }, 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);

  const limiter = rateLimit(`mobile-attendance:save:${actor.userId}:${ipFromRequest(request)}`, 30, 10 * 60 * 1000);
  if (!limiter.ok) return response({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' } }, 429);

  const parsed = saveAttendanceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: 'Confira os registros informados.' } }, 422);

  try {
    const { eventId } = await context.params;
    return response(await saveMobileAttendance({ userId: actor.userId, contaId: actor.contaId }, eventId, parsed.data));
  } catch (error) {
    const knownError = knownMobileAgendaError(error);
    if (knownError) return response(knownError.body, knownError.status);
    const handled = authError(error);
    if (handled) return handled;
    console.error('[mobile-attendance][save]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'OPERATION_FAILED', message: 'Não foi possível salvar a frequência.' } }, 409);
  }
}
