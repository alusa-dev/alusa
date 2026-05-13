import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getAsaasWebhookOperationalStatus } from '@alusa/finance';

export const dynamic = 'force-dynamic';

function isCronRequest(req: NextRequest): boolean {
  return Boolean(process.env.CRON_SECRET_TOKEN && req.headers.get('x-cron-token') === process.env.CRON_SECRET_TOKEN);
}

export async function GET(req: NextRequest) {
  try {
    const requestedContaId = req.nextUrl.searchParams.get('contaId')?.trim() || undefined;

    if (isCronRequest(req)) {
      const data = await getAsaasWebhookOperationalStatus({ contaId: requestedContaId });
      return NextResponse.json({ success: true, data });
    }

    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; contaId?: string; role?: string } | undefined;
    if (!user?.id) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const role = user.role?.toUpperCase();
    const isTenantAdmin = role === 'ADMIN';
    const isPlatformAdmin = role === 'SUPER_ADMIN';
    if (!isPlatformAdmin && !user.contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }
    if (!isTenantAdmin && !isPlatformAdmin) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    if (!isPlatformAdmin && requestedContaId && requestedContaId !== user.contaId) {
      return NextResponse.json({ success: false, error: 'Conta inválida' }, { status: 403 });
    }

    const data = await getAsaasWebhookOperationalStatus({
      contaId: isPlatformAdmin ? requestedContaId : user.contaId!,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[admin/webhooks/status] Erro:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}
