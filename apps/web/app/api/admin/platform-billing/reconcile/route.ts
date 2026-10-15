import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
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

  if (parsed.data.scope === 'batch' && sessionUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
  }
  if (parsed.data.scope === 'current_account' && !sessionUser.contaId) {
    return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
  }

  const result = await reconcilePlatformBilling({
    contaId: parsed.data.scope === 'current_account' ? sessionUser.contaId! : undefined,
    limit: parsed.data.limit,
  });

  return NextResponse.json(result);
}

async function requireAdminSession(): Promise<{ id: string; contaId: string | null; role: string } | null> {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; contaId?: string; role?: string } } | null)?.user;
  const role = String(user?.role ?? '').toUpperCase();
  if (!user?.id || (role !== 'ADMIN' && role !== 'SUPER_ADMIN')) return null;
  if (role !== 'SUPER_ADMIN' && !user.contaId) return null;
  return { id: user.id, contaId: user.contaId ?? null, role };
}
