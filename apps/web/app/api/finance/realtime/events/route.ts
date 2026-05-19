import { NextRequest, NextResponse } from 'next/server';
import { listFinanceRealtimeEvents } from '@alusa/finance';
import { getSessionUser } from '@/lib/auth/session';

export const revalidate = 0;

/**
 * GET /api/finance/realtime/events?since=<ms>
 * Retorna eventos financeiros publicados após webhooks (poll pelo cliente).
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.contaId) {
    return NextResponse.json({ success: false, error: 'Não autenticado' }, { status: 401 });
  }

  const sinceParam = req.nextUrl.searchParams.get('since');
  const since = sinceParam ? Number(sinceParam) : 0;
  const safeSince = Number.isFinite(since) && since > 0 ? since : 0;

  const events = await listFinanceRealtimeEvents({
    contaId: user.contaId,
    since: safeSince,
    limit: 50,
  });

  return NextResponse.json({
    success: true,
    events,
    serverTime: Date.now(),
  });
}
