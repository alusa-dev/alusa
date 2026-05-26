import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import {
  processAsaasWebhookQueueWithInbox,
  recordFinanceAdminAction,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const body = (await req.json().catch(() => ({}))) as {
      limit?: number;
      asaasPaymentId?: string;
      eventName?: string;
      reason?: string;
    };
    const reason = body.reason?.trim();
    if (!reason || reason.length < 8) {
      return json(400, { error: 'JUSTIFICATIVA_OBRIGATORIA' });
    }

    if (body.asaasPaymentId) {
      await recordFinanceAdminAction({
        contaId: user.contaId,
        action: 'finance.webhooks.reconcile_payment.manual',
        entity: { type: 'Payment', id: body.asaasPaymentId },
        reason,
        actor: { type: 'ADMIN', id: user.id },
        metadata: { eventName: body.eventName ?? null },
      });

      const result = await syncPaymentStateFromAsaas({
        contaId: user.contaId,
        asaasPaymentId: body.asaasPaymentId,
        eventName: body.eventName,
      });

      if (!result.success) {
        return json(422, { ok: false, error: result.error });
      }

      return json(200, { ok: true, mode: 'payment', result });
    }

    await recordFinanceAdminAction({
      contaId: user.contaId,
      action: 'finance.webhooks.reprocess_queue.manual',
      reason,
      actor: { type: 'ADMIN', id: user.id },
      metadata: { limit: body.limit ?? 50, statuses: ['ERRO'] },
    });

    const result = await processAsaasWebhookQueueWithInbox({
      contaId: user.contaId,
      limit: body.limit ?? 50,
      statuses: ['ERRO'],
      source: 'REPROCESS',
    });

    return json(200, { ok: true, mode: 'queue', result });
  } catch (error) {
    console.error('[Admin Financial Webhooks Reprocess][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
