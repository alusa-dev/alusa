import { NextResponse } from 'next/server';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import {
  acceptInviteInputDTOSchema,
  acceptInviteResultDTOSchema,
  validateInviteQueryDTOSchema,
  validateInviteResultDTOSchema,
} from '@/features/users/dtos';
import {
  findPendingInviteForAcceptance,
} from '@/src/server/users/invite-acceptance.service';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { acceptInviteApplication } from '@/src/server/users/invite-acceptance.application-service';

export async function GET(req: Request) {
  try {
    // Rate limit: 60 reqs / 15 min por IP (consulta de token)
    const ip = ipFromRequest(req);
    const rl = rateLimit(`accept-invite:validate:${ip}`, 60, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token') || '';
    const parsed = validateInviteQueryDTOSchema.safeParse({ token });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Token ausente' }, { status: 400 });
    }

    const invite = await findPendingInviteForAcceptance(token, {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
    });
    if (!invite || invite.status !== 'PENDING') {
      return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      await InviteUserService.expirePendingInvite(token);
      return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
    }
    return NextResponse.json(
      validateInviteResultDTOSchema.parse({ email: invite.email, role: invite.role }),
    );
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/accept', method: 'GET', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ip = ipFromRequest(req);
    const rl = rateLimit(`accept-invite:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const body: unknown = await req.json();
    const parsed = acceptInviteInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.errors }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const result = await acceptInviteApplication({
      input: parsed.data,
      ip,
      userAgent: req.headers.get('user-agent'),
      authenticatedUserId: session?.user?.id || undefined,
      sessionEmail: session?.user?.email,
      sessionAuthContext: (session?.user as { authContext?: 'OWNER' | 'COLLABORATOR' | 'PORTAL' } | undefined)?.authContext,
    });
    if (result.deliveryWarning) {
      logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/accept', method: 'POST', requestId: getRequestId(req) });
    }
    const bodyResult = result.status === 200
      ? acceptInviteResultDTOSchema.parse(result.body)
      : result.body;
    return NextResponse.json(bodyResult, { status: result.status });
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/accept', method: 'POST', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
