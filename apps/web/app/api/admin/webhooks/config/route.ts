import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { getWebhookConfigDriftStatus, recordFinanceAdminAction, repairWebhookConfigDrift } from '@alusa/finance';
import { adminWebhookConfigRepairInputDTOSchema } from '@/features/system/dtos';

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

export async function POST(req: Request) {
  try {
    const auth = await requireAdminSession();
    if ('error' in auth) return auth.error;

    const contaId = auth.session.user.contaId;
    if (!contaId) {
      return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 });
    }

    const { reason } = adminWebhookConfigRepairInputDTOSchema.parse(await req.json().catch(() => ({})));

    await recordFinanceAdminAction({
      contaId,
      action: 'finance.webhook.config_repair.requested',
      reason,
      actor: { type: 'ADMIN', id: auth.session.user.id },
    });

    const result = await repairWebhookConfigDrift({
      contaId,
      actor: { type: 'ADMIN', id: auth.session.user.id },
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Justificativa obrigatória' }, { status: 400 });
    }
    console.error('[admin/webhooks/config] Erro ao reparar drift:', error);
    return NextResponse.json({ success: false, error: 'Erro interno' }, { status: 500 });
  }
}
