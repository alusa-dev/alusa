import { NextResponse } from 'next/server';
import {
  inviteCandidatesQueryDTOSchema,
  inviteCandidatesResultDTOSchema,
} from '@/features/users/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { findInviteCandidatesInConta } from '@/src/server/users/invite-scope.service';

export async function GET(req: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const role = String(auth.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'RECEPCAO') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const parsed = inviteCandidatesQueryDTOSchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    if (role === 'RECEPCAO' && parsed.data.recordType !== 'RESPONSAVEL') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await findInviteCandidatesInConta({
      contaId: auth.contaId,
      recordType: parsed.data.recordType,
      query: parsed.data.q,
      page: parsed.data.page,
      limit: parsed.data.limit,
    });
    return NextResponse.json(inviteCandidatesResultDTOSchema.parse({
      ...result,
      page: parsed.data.page,
      limit: parsed.data.limit,
    }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logApiOperationalEvent({
      severity: 'error', eventName: 'api.users.request.failed',
      route: '/api/users/invite/candidates', method: 'GET', requestId: getRequestId(req), error,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
