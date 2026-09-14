import { NextResponse } from 'next/server';

import { EventsError } from '@alusa/lib';

import {
  MobileEventsForbiddenError,
  type MobileEventsActor,
} from './mobile-events.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';

export function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

export async function authenticate(request: Request): Promise<MobileEventsActor | null> {
  const token = bearerToken(request);
  const actor = token ? await verifyMobileAccessToken(token) : null;
  return actor ? { userId: actor.userId, contaId: actor.contaId, role: actor.role } : null;
}

export function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function unauthorized() {
  return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
}

export function handleMobileEventsError(error: unknown, fallbackMessage: string) {
  if (error instanceof MobileEventsForbiddenError) {
    return response({ error: { code: 'FORBIDDEN', message: error.message } }, 403);
  }

  if (error instanceof EventsError) {
    return response({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
  }

  console.error('[api/mobile/events]', error instanceof Error ? error.message : String(error));
  return response({ error: { code: 'SERVER_ERROR', message: fallbackMessage } }, 500);
}
