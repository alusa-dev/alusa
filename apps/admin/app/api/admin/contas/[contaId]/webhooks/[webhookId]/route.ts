import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { getSupportWebhookDetail } from '@/features/support/queries/support-entities';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contaId: string; webhookId: string }> },
) {
  const { contaId, webhookId } = await params;
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_VIEWER', 'SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'admin-webhooks',
  });
  if (!auth.ok) return auth.response;

  const webhook = await getSupportWebhookDetail(contaId, webhookId);
  if (!webhook) {
    return NextResponse.json(
      { success: false, error: 'Webhook não encontrado' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        id: webhook.id,
        evento: webhook.evento,
        eventId: webhook.eventId,
        status: webhook.status,
        recebidoEm: webhook.recebidoEm,
        processadoEm: webhook.processadoEm,
        ultimoErro: webhook.ultimoErro,
        tentativas: webhook.tentativas,
        asaasPaymentId: webhook.asaasPaymentId,
        asaasSubscriptionId: webhook.asaasSubscriptionId,
        asaasTransferId: webhook.asaasTransferId,
        payload: webhook.payload,
        attemptsLog: webhook.attemptsLog,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
