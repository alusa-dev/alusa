import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getWebhookOperationalDiagnostics } from '@alusa/finance';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const includeGaps = req.nextUrl.searchParams.get('includeGaps') === 'true';
    const windowDaysRaw = Number(req.nextUrl.searchParams.get('windowDays') ?? '7');
    const windowDays = Number.isFinite(windowDaysRaw)
      ? Math.max(1, Math.min(30, windowDaysRaw))
      : 7;

    const diagnostics = await getWebhookOperationalDiagnostics({
      contaId: session.user.contaId,
      includeGaps,
      windowDays,
    });

    return NextResponse.json({
      success: true,
      data: diagnostics,
    });
  } catch (error) {
    console.error('[admin/webhooks/diagnostics] Erro:', error);
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}
