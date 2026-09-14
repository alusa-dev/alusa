import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { searchFinancePayers } from '@/features/billing/server/finance-payers-search.service';
import { authOptions } from '@/lib/auth-options';

type SessionUser = { contaId?: string };

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET(request: NextRequest) {
  const user = await resolveAuth();
  if (!user?.contaId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const result = await searchFinancePayers(user.contaId, request.nextUrl.searchParams.get('q') ?? '');
  return NextResponse.json(result);
}
