import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const sessionUser = await requireAdminSession();
  if (!sessionUser) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const url = new URL(req.url);
  const environment = resolvePlatformBillingEnvironment();
  const statuses = url.searchParams.getAll('status');
  const normalizedStatuses = statuses.length > 0
    ? statuses.map((status) => status.toUpperCase()).filter((status) => ['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING'].includes(status))
    : ['FAILED', 'EXHAUSTED'];
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100));

  const events = await prisma.platformBillingWebhookEvent.findMany({
    where: {
      contaId: sessionUser.contaId,
      environment,
      status: { in: normalizedStatuses as Array<'FAILED' | 'EXHAUSTED' | 'PENDING' | 'PROCESSING'> },
    },
    orderBy: [{ receivedAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      eventId: true,
      eventType: true,
      status: true,
      attempts: true,
      receivedAt: true,
      lastAttemptAt: true,
      nextAttemptAt: true,
      lastError: true,
      lastErrorCode: true,
      exhaustedAt: true,
      correlationId: true,
    },
  });

  return NextResponse.json({
    environment,
    events: events.map((event) => ({
      ...event,
      receivedAt: event.receivedAt.toISOString(),
      lastAttemptAt: event.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
      exhaustedAt: event.exhaustedAt?.toISOString() ?? null,
      lastError: event.lastError ? event.lastError.slice(0, 500) : null,
    })),
  });
}

async function requireAdminSession(): Promise<{ id: string; contaId: string } | null> {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; contaId?: string; role?: string } } | null)?.user;
  if (!user?.id || !user.contaId || String(user.role).toUpperCase() !== 'ADMIN') return null;
  return { id: user.id, contaId: user.contaId };
}
