import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { replayStripeWebhookEvents } from '@/src/server/platform-billing/webhook-worker';
import { resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';

export const runtime = 'nodejs';

const replaySchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(100),
  reason: z.string().trim().min(5).max(500),
});

export async function POST(req: NextRequest) {
  const sessionUser = await requireAdminSession();
  if (!sessionUser) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = replaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() }, { status: 400 });
  }

  const environment = resolvePlatformBillingEnvironment();
  const eligibleEvents = await prisma.platformBillingWebhookEvent.findMany({
    where: {
      id: { in: parsed.data.ids },
      contaId: sessionUser.contaId,
      environment,
      status: { in: ['FAILED', 'EXHAUSTED'] },
    },
    select: { id: true },
  });

  const result = await replayStripeWebhookEvents({
    prisma,
    ids: eligibleEvents.map((event) => event.id),
    actorUserId: sessionUser.id,
    reason: parsed.data.reason,
    environment,
  });

  return NextResponse.json(result);
}

async function requireAdminSession(): Promise<{ id: string; contaId: string } | null> {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; contaId?: string; role?: string } } | null)?.user;
  if (!user?.id || !user.contaId || String(user.role).toUpperCase() !== 'ADMIN') return null;
  return { id: user.id, contaId: user.contaId };
}
