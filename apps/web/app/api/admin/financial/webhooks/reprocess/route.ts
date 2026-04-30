import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import {
  emitBillingNotificationCandidate,
  emitBillingNotifications,
} from '@/lib/notifications/emit-billing-notifications';
import { processAsaasWebhookQueue, syncPaymentStateFromAsaas } from '@alusa/finance';

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
    };

    if (body.asaasPaymentId) {
      const result = await syncPaymentStateFromAsaas({
        contaId: user.contaId,
        asaasPaymentId: body.asaasPaymentId,
        eventName: body.eventName,
      });

      if (!result.success) {
        return json(422, { ok: false, error: result.error });
      }

      try {
        await emitBillingNotificationCandidate(
          {
            event: result.appliedEvent,
            asaasPaymentId: body.asaasPaymentId,
          },
          'ASAAS_SYNC',
        );
      } catch (error) {
        console.warn('[Admin Financial Webhooks Reprocess][POST] Falha não crítica ao emitir notificação', {
          contaId: user.contaId,
          asaasPaymentId: body.asaasPaymentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return json(200, { ok: true, mode: 'payment', result });
    }

    const result = await processAsaasWebhookQueue({
      contaId: user.contaId,
      limit: body.limit ?? 50,
      statuses: ['ERRO'],
      source: 'REPROCESS',
    });

    try {
      await emitBillingNotifications(result.processedPayments, 'ASAAS_WEBHOOK');
    } catch (error) {
      console.warn('[Admin Financial Webhooks Reprocess][POST] Falha não crítica ao emitir notificações', {
        contaId: user.contaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return json(200, { ok: true, mode: 'queue', result });
  } catch (error) {
    console.error('[Admin Financial Webhooks Reprocess][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
