import { NextResponse } from 'next/server';
import { AsaasNotificationEvent } from '@prisma/client';
import { z } from 'zod';

import {
  getMobileStudentNotifications,
  MobileStudentNotFoundError,
  MobileStudentUnauthorizedError,
  saveMobileStudentNotifications,
} from '@/features/students/server/mobile-students.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

const notificationInputSchema = z.object({
  id: z.string().trim().optional(),
  event: z.nativeEnum(AsaasNotificationEvent),
  scheduleOffset: z.number().int().min(0).max(60),
  enabled: z.boolean(),
  emailEnabledForCustomer: z.boolean(),
  smsEnabledForCustomer: z.boolean(),
  whatsappEnabledForCustomer: z.boolean(),
  phoneCallEnabledForCustomer: z.boolean(),
});

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function result(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function authenticate(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return result({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  try {
    const { studentId } = await params;
    return result(await getMobileStudentNotifications({ userId: actor.userId, contaId: actor.contaId, studentId }));
  } catch (error) {
    if (error instanceof MobileStudentUnauthorizedError) return result({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileStudentNotFoundError) return result({ error: { code: 'NOT_FOUND', message: 'Aluno não encontrado.' } }, 404);
    console.error('[mobile-students][notifications-get]', { error: error instanceof Error ? error.message : String(error) });
    return result({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar as configurações de avisos.' } }, 500);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return result({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!['ADMIN', 'FINANCEIRO'].includes(actor.role.trim().toUpperCase())) {
    return result({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para editar os avisos.' } }, 403);
  }
  try {
    const { studentId } = await params;
    const parsed = z.object({ preferences: z.array(notificationInputSchema).min(1) }).safeParse(await request.json());
    if (!parsed.success) return result({ error: { code: 'INVALID_INPUT', message: 'Confira as configurações informadas.' } }, 422);
    return result(await saveMobileStudentNotifications({ userId: actor.userId, contaId: actor.contaId, studentId, preferences: parsed.data.preferences }));
  } catch (error) {
    if (error instanceof MobileStudentUnauthorizedError) return result({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileStudentNotFoundError) return result({ error: { code: 'NOT_FOUND', message: 'Aluno não encontrado.' } }, 404);
    console.error('[mobile-students][notifications-save]', { error: error instanceof Error ? error.message : String(error) });
    return result({ error: { code: 'SERVER_ERROR', message: 'Não foi possível salvar as configurações de avisos.' } }, 500);
  }
}
