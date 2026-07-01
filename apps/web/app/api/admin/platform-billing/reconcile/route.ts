import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { reconcilePlatformBilling } from '@/src/server/platform-billing/reconciliation';

export const runtime = 'nodejs';

const reconcileSchema = z.object({
  scope: z.enum(['current_account', 'batch']).default('current_account'),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const sessionUser = await requireAdminSession();
  if (!sessionUser) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = reconcileSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await reconcilePlatformBilling({
    prisma,
    contaId: parsed.data.scope === 'current_account' ? sessionUser.contaId : undefined,
    limit: parsed.data.limit,
  });

  return NextResponse.json(result);
}

async function requireAdminSession(): Promise<{ id: string; contaId: string } | null> {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; contaId?: string; role?: string } } | null)?.user;
  if (!user?.id || !user.contaId || String(user.role).toUpperCase() !== 'ADMIN') return null;
  return { id: user.id, contaId: user.contaId };
}
