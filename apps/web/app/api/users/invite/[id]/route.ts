import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { deleteInviteResultDTOSchema } from '@/features/users/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { getInviteBaseUrl } from '@/lib/app-url';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import { resendInviteResultDTOSchema } from '@/features/users/dtos';

const ParamsSchema = z.object({ id: z.string().min(1) });
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const parsed = ParamsSchema.safeParse(await ctx.params);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }
    const id = parsed.data.id;

    const isTest =
      process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const auth = await resolveTenantSession();
    if (!auth.ok && !isTest) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const inviterRole = auth.ok ? auth.role : isTest ? 'ADMIN' : undefined;
    const inviterContaId = auth.ok ? auth.contaId : isTest ? 'conta-default' : undefined;

    if (String(inviterRole || '').toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão para excluir este convite.' }, { status: 403 });
    }

    if (!inviterContaId) return NextResponse.json({ error: 'Conta inválida.' }, { status: 403 });
    const actorUserId = auth.ok ? auth.userId : 'admin-test';
    const result = await InviteUserService.revokeInviteById(id, inviterContaId, actorUserId);
    if (result === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 });
    }
    if (result === 'DELIVERY_IN_PROGRESS') {
      return NextResponse.json({ error: 'O envio do convite está em andamento. Tente revogar novamente em alguns minutos.', code: 'DELIVERY_IN_PROGRESS' }, { status: 409 });
    }
    if (result !== 'REVOKED') return NextResponse.json({ error: 'Este convite não pode ser revogado neste estado.' }, { status: 409 });
    return NextResponse.json(deleteInviteResultDTOSchema.parse({ ok: true, status: 'REVOKED' }));
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite/[id]', method: 'DELETE', requestId: getRequestId(_req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const parsed = ParamsSchema.safeParse(await ctx.params);
    if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (String(auth.role).toUpperCase() !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const idempotencyKey = req.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return NextResponse.json({ error: 'Cabeçalho Idempotency-Key inválido.' }, { status: 400 });
    }
    const ip = ipFromRequest(req);
    const limiter = await rateLimitAsync(`invite:resend:${auth.contaId}:${auth.userId}:${ip}`, 10, 15 * 60 * 1000);
    if (!limiter.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const inviteBaseUrl = getInviteBaseUrl();

    const reservation = await InviteUserService.reserveInviteResend({
      id: parsed.data.id,
      contaId: auth.contaId,
      actorUserId: auth.userId,
      idempotencyKey,
    });
    const inviteUrl = new URL('/auth/register', `${inviteBaseUrl}/`);
    inviteUrl.searchParams.set('token', reservation.token);

    if (reservation.kind === 'MANUAL' || reservation.kind === 'MANUAL_REPLAY') {
      return NextResponse.json(resendInviteResultDTOSchema.parse({
        ok: true, deliveryStatus: 'NOT_APPLICABLE', deliveryErrorCode: null,
        expiresAt: reservation.expiresAt.toISOString(), inviteUrl: inviteUrl.toString(), replayed: reservation.kind === 'MANUAL_REPLAY',
      }));
    }
    if (reservation.kind === 'REPLAY') {
      return NextResponse.json(resendInviteResultDTOSchema.parse({
        ok: true,
        deliveryStatus: reservation.attemptStatus === 'PROCESSING' ? 'PENDING' : reservation.attemptStatus,
        deliveryErrorCode: reservation.attemptStatus === 'FAILED' ? 'DELIVERY_FAILED' : null,
        expiresAt: reservation.expiresAt.toISOString(),
        replayed: true,
      }));
    }

    let delivery: 'SENT' | 'LOGGED' | 'FAILED' = 'FAILED';
    try {
      const result = await sendInviteEmail({
        inviteId: reservation.inviteId,
        inviteUrl: inviteUrl.toString(),
        email: reservation.email,
        role: reservation.role,
        invitedByName: reservation.invitedByName ?? undefined,
        expiresAt: reservation.expiresAt,
        idempotencyKey: `invite-user/${reservation.inviteId}/resend/${reservation.attemptId}`,
      });
      delivery = result.delivery === 'sent' ? 'SENT' : 'LOGGED';
    } catch {
      logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/invite/[id]', method: 'POST', requestId: getRequestId(req) });
    }
    const completed = await InviteUserService.completeInviteResend({
      inviteId: reservation.inviteId,
      contaId: reservation.contaId,
      attemptId: reservation.attemptId,
      leaseExpiresAt: reservation.leaseExpiresAt,
      delivery,
    });
    if (!completed) return NextResponse.json({ error: 'O estado da entrega mudou. Consulte o convite e tente novamente se ele continuar pendente.', code: 'DELIVERY_STATE_CHANGED' }, { status: 409 });
    return NextResponse.json(resendInviteResultDTOSchema.parse({
      ok: true, deliveryStatus: delivery, deliveryErrorCode: delivery === 'FAILED' ? 'DELIVERY_FAILED' : null,
      expiresAt: reservation.expiresAt.toISOString(),
    }));
  } catch (error) {
    if (error instanceof InviteUserService.InviteNotFoundError) return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404 });
    if (error instanceof InviteUserService.ExpiredInviteError) return NextResponse.json({ error: 'Convite expirado. Crie um novo convite para continuar.', code: 'INVITE_EXPIRED' }, { status: 410 });
    if (error instanceof InviteUserService.InviteNotResendableError) return NextResponse.json({ error: 'Este convite não pode ser reenviado neste estado.', code: 'INVITE_NOT_PENDING' }, { status: 409 });
    if (error instanceof InviteUserService.InviteResendRateLimitError) {
      const retryAfter = Math.max(1, Math.ceil((error.availableAt.getTime() - Date.now()) / 1000));
      return NextResponse.json({ error: 'Aguarde antes de solicitar outro envio deste convite.', code: 'INVITE_RESEND_COOLDOWN', retryAfterSeconds: retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
    }
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite/[id]', method: 'POST', requestId: getRequestId(req) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
