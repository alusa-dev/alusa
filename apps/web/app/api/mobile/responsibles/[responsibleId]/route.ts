import { NextResponse } from 'next/server';

import {
  deleteMobileResponsible,
  getMobileResponsibleDetail,
  MobileResponsibleNotFoundError,
  MobileResponsibleUnauthorizedError,
  updateMobileResponsible,
} from '@/features/responsibles/server/mobile-responsibles.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';

function token(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  return value?.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() || null : null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function actorFrom(request: Request) {
  return verifyMobileAccessToken(token(request) ?? '');
}

export async function GET(request: Request, { params }: { params: Promise<{ responsibleId: string }> }) {
  const actor = await actorFrom(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  try {
    const { responsibleId } = await params;
    return response({ responsible: await getMobileResponsibleDetail({ userId: actor.userId, contaId: actor.contaId, responsibleId }) });
  } catch (error) {
    if (error instanceof MobileResponsibleUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileResponsibleNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Responsável não encontrado.' } }, 404);
    console.error('[mobile-responsibles][detail]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar os dados do responsável.' } }, 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ responsibleId: string }> }) {
  const actor = await actorFrom(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!['ADMIN', 'GESTOR', 'FINANCEIRO', 'RECEPCAO'].includes(actor.role.toUpperCase())) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para editar responsáveis.' } }, 403);
  try {
    const { responsibleId } = await params;
    return response(await updateMobileResponsible({ userId: actor.userId, contaId: actor.contaId, responsibleId, data: await request.json() }));
  } catch (error) {
    if (error instanceof MobileResponsibleUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileResponsibleNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Responsável não encontrado.' } }, 404);
    if (error instanceof Error && (error.name === 'ZodError' || error.message.includes('campo válido'))) return response({ error: { code: 'INVALID_INPUT', message: error.message } }, 422);
    console.error('[mobile-responsibles][update]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível salvar os dados do responsável.' } }, 500);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ responsibleId: string }> }) {
  const actor = await actorFrom(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!['ADMIN', 'GESTOR'].includes(actor.role.toUpperCase())) return response({ error: { code: 'FORBIDDEN', message: 'Apenas administradores e gestores podem excluir responsáveis.' } }, 403);
  try {
    const { responsibleId } = await params;
    return response(await deleteMobileResponsible({ userId: actor.userId, contaId: actor.contaId, responsibleId }));
  } catch (error) {
    if (error instanceof MobileResponsibleUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileResponsibleNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Responsável não encontrado.' } }, 404);
    if (error instanceof Error && error.message.startsWith('Não é possível excluir')) return response({ error: { code: 'CONFLICT', message: error.message } }, 409);
    console.error('[mobile-responsibles][delete]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível excluir o responsável.' } }, 500);
  }
}
