import { NextResponse } from 'next/server';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import {
  createInviteInputDTOSchema,
  listInvitesResultDTOSchema,
} from '@/features/users/dtos';
import { mapInviteRecordToDTO } from '@/features/users/mappers';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { createInviteApplication, validateInviteCreationInput } from '@/src/server/users/invite-creation.application-service';

export async function POST(req: Request) {
  try {
    const ip = ipFromRequest(req);
    const rl = rateLimit(`invite:create:${ip}`, 30, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const body: unknown = await req.json();
    const parsed = createInviteInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.errors }, { status: 400 });
    }
    const inputValidation = validateInviteCreationInput(parsed.data);
    if (inputValidation) {
      if (inputValidation.rejected) {
        logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.request.rejected', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
      }
      return NextResponse.json(inputValidation.body, { status: inputValidation.status });
    }

    const isTest = process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const auth = await resolveTenantSession();
    if (!auth.ok && !isTest) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = auth.ok ? auth.userId : isTest ? 'admin-mock' : undefined;
    const contaId = auth.ok ? auth.contaId : undefined;
    if (!userId || !contaId) return NextResponse.json({ error: 'Conta inválida.' }, { status: 403 });

    const result = await createInviteApplication({
      input: parsed.data,
      contaId,
      userId,
      role: auth.ok ? auth.role ?? '' : 'ADMIN',
      name: auth.ok ? auth.name : undefined,
    });
    if (result.rejected) {
      logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.request.rejected', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
    }
    if (result.operationalError === 'base-url') {
      logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
    } else if (result.operationalError === 'delivery') {
      logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const role = String(auth.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'RECEPCAO') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const contaId = auth.contaId;
    const invites = await InviteUserService.listInvitesByConta(contaId);
    return NextResponse.json(
      listInvitesResultDTOSchema.parse({
        items: invites
          .filter((invite) => role === 'ADMIN' || invite.role === 'RESPONSAVEL')
          .map((invite) => mapInviteRecordToDTO(invite as Record<string, unknown>)),
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite', method: 'GET', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
