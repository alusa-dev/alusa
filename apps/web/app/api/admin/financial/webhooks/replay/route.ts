import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { replayWebhookByEventId, replayWebhooksByDateRange } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

type ReplayBody = {
  eventId?: string;
  force?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  status?: 'PROCESSADO' | 'ERRO' | 'PENDENTE';
  category?: string;
};

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const body = (await req.json().catch(() => ({}))) as ReplayBody;

    if (body.eventId) {
      const result = await replayWebhookByEventId({
        contaId: user.contaId,
        eventId: body.eventId,
        force: body.force,
      });

      return json(200, { ok: true, result });
    }

    const from = parseDate(body.from);
    const to = parseDate(body.to);

    if (!from || !to) return json(400, { error: 'PARAMETROS_INVALIDOS' });

    const result = await replayWebhooksByDateRange({
      contaId: user.contaId,
      from,
      to,
      limit: body.limit,
      offset: body.offset,
      status: body.status,
      category: body.category,
    });

    return json(200, { ok: true, result });
  } catch (error) {
    console.error('[Admin Financial Webhooks Replay][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
