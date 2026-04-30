import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getWebhookConfigDriftStatus, repairWebhookConfigDrift } from '@alusa/finance';

async function requireAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.contaId) {
    return {
      error: NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 }),
    };
  }

  const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
  if (!isAdmin) {
    return {
      error: NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 }),
    };
  }

  return { session };
}

export async function GET() {
  try {
    const auth = await requireAdminSession();
    if ('error' in auth) return auth.error;

    const contaId = auth.session.user.contaId;
    if (!contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const drift = await getWebhookConfigDriftStatus(contaId);

    return NextResponse.json({
      success: true,
      data: drift,
    });
  } catch (error) {
    console.error('[admin/webhooks/config] Erro ao consultar drift:', error);
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = await requireAdminSession();
    if ('error' in auth) return auth.error;

    const contaId = auth.session.user.contaId;
    if (!contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const result = await repairWebhookConfigDrift({
      contaId,
      actor: { type: 'USER', id: auth.session.user.id },
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[admin/webhooks/config] Erro ao reparar drift:', error);
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}