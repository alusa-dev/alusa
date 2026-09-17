import { NextResponse } from 'next/server';

import { getMobileResponsibleNotifications, MobileResponsibleNotFoundError, MobileResponsibleUnauthorizedError, saveMobileResponsibleNotifications } from '@/features/responsibles/server/mobile-responsibles.service';
import {
  saveMobileAsaasNotificationPreferencesInputDTOSchema,
} from '@/features/configuracoes/notificacoes/asaas/dtos';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';

export const runtime = 'nodejs';
function bearer(request: Request) { const value = request.headers.get('authorization')?.trim(); return value?.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() || null : null; }
function result(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function actor(request: Request) { const value = bearer(request); return value ? verifyMobileAccessToken(value) : null; }

export async function GET(request: Request, { params }: { params: Promise<{ responsibleId: string }> }) {
  const current = await actor(request); if (!current) return result({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  try { const { responsibleId } = await params; return result(await getMobileResponsibleNotifications({ userId: current.userId, contaId: current.contaId, responsibleId })); }
  catch (error) { if (error instanceof MobileResponsibleUnauthorizedError) return result({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403); if (error instanceof MobileResponsibleNotFoundError) return result({ error: { code: 'NOT_FOUND', message: 'Responsável não encontrado.' } }, 404); console.error('[mobile-responsibles][notifications-get]', error); return result({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar as configurações de avisos.' } }, 500); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ responsibleId: string }> }) {
  const current = await actor(request); if (!current) return result({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!['ADMIN', 'FINANCEIRO'].includes(current.role.trim().toUpperCase())) return result({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para editar os avisos.' } }, 403);
  try { const { responsibleId } = await params; const parsed = saveMobileAsaasNotificationPreferencesInputDTOSchema.safeParse(await request.json()); if (!parsed.success) return result({ error: { code: 'INVALID_INPUT', message: 'Confira as configurações informadas.' } }, 422); return result(await saveMobileResponsibleNotifications({ userId: current.userId, contaId: current.contaId, responsibleId, preferences: parsed.data.preferences })); }
  catch (error) { if (error instanceof MobileResponsibleUnauthorizedError) return result({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403); if (error instanceof MobileResponsibleNotFoundError) return result({ error: { code: 'NOT_FOUND', message: 'Responsável não encontrado.' } }, 404); console.error('[mobile-responsibles][notifications-save]', error); return result({ error: { code: 'SERVER_ERROR', message: 'Não foi possível salvar as configurações de avisos.' } }, 500); }
}
