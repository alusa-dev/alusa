import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@alusa/database';
import { evaluateFinancialOperationalHealth } from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const result = await evaluateFinancialOperationalHealth({ contaId: user.contaId });
    const alerts = await prisma.financialOperationalAlert.findMany({
      where: {
        contaId: user.contaId,
        status: 'OPEN',
      },
      orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
      take: 100,
    });

    return json(200, {
      success: true,
      result,
      alerts,
    });
  } catch (error) {
    console.error('[Admin Financial Operational Health][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
