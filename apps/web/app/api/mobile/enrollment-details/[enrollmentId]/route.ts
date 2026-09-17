import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  executeMobileEnrollmentAction,
  getMobileEnrollment,
  MobileEnrollmentNotFoundError,
  MobileEnrollmentUnauthorizedError,
  updateMobileEnrollment,
  updateMobileEnrollmentPayment,
  deleteMobileEnrollment,
} from '@/features/enrollments/server/mobile-enrollments.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function authenticate(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

function allowedToEdit(role: string) {
  return ['ADMIN', 'GESTOR', 'FINANCEIRO', 'RECEPCAO'].includes(role.trim().toUpperCase());
}

function allowedToManage(role: string) {
  return ['ADMIN', 'GESTOR'].includes(role.trim().toUpperCase());
}

const updateSchema = z.object({
  dataFimContrato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vencimentoDia: z.number().int().min(1).max(28).optional(),
  turmaId: z.string().trim().min(1).nullable().optional(),
  planoId: z.string().trim().min(1).nullable().optional(),
  comboId: z.string().trim().min(1).nullable().optional(),
  paymentMethod: z.enum(['BOLETO', 'PIX', 'CARTAO_CREDITO', 'INDEFINIDO']).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Informe pelo menos um campo para atualização.' });

const actionSchema = z.object({
  action: z.enum(['PAUSE', 'REACTIVATE', 'CANCEL']),
  reason: z.string().trim().max(500).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ enrollmentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);

  try {
    const { enrollmentId } = await params;
    const enrollment = await getMobileEnrollment({ userId: actor.userId, contaId: actor.contaId }, enrollmentId);
    if (!enrollment) return response({ error: { code: 'NOT_FOUND', message: 'Matrícula não encontrada.' } }, 404);
    return response({ enrollment });
  } catch (error) {
    if (error instanceof MobileEnrollmentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    console.error('[mobile-enrollments][detail]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar a matrícula.' } }, 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ enrollmentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!allowedToEdit(actor.role)) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para editar esta matrícula.' } }, 403);

  try {
    const { enrollmentId } = await params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Confira os dados informados.' } }, 422);
    const { paymentMethod, ...enrollmentData } = parsed.data;
    await updateMobileEnrollment({ actor: { userId: actor.userId, contaId: actor.contaId }, enrollmentId, data: enrollmentData });
    if (paymentMethod) await updateMobileEnrollmentPayment({ actor: { userId: actor.userId, contaId: actor.contaId }, enrollmentId, paymentMethod });
    return response({ success: true });
  } catch (error) {
    if (error instanceof MobileEnrollmentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileEnrollmentNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Matrícula não encontrada.' } }, 404);
    console.error('[mobile-enrollments][update]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'UPDATE_FAILED', message: 'Não foi possível salvar as alterações.' } }, 409);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ enrollmentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!allowedToManage(actor.role)) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para alterar o status da matrícula.' } }, 403);

  try {
    const { enrollmentId } = await params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Ação inválida.' } }, 422);
    const result = await executeMobileEnrollmentAction({ actor: { userId: actor.userId, contaId: actor.contaId }, enrollmentId, ...parsed.data });
    return response({ success: true, result });
  } catch (error) {
    if (error instanceof MobileEnrollmentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileEnrollmentNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Matrícula não encontrada.' } }, 404);
    console.error('[mobile-enrollments][action]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'ACTION_FAILED', message: 'Não foi possível concluir a ação.' } }, 409);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ enrollmentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!allowedToManage(actor.role)) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para excluir esta matrícula.' } }, 403);
  try {
    const { enrollmentId } = await params;
    await deleteMobileEnrollment({ actor: { userId: actor.userId, contaId: actor.contaId }, enrollmentId });
    return response({ success: true });
  } catch (error) {
    if (error instanceof MobileEnrollmentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileEnrollmentNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Matrícula não encontrada.' } }, 404);
    return response({ error: { code: 'DELETE_BLOCKED', message: 'Não foi possível excluir a matrícula.' } }, 409);
  }
}
