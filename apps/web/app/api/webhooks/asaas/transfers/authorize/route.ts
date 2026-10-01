import { NextRequest, NextResponse } from 'next/server';

import {
  handleTransferAuthorizationWebhook,
  resolveAsaasWebhookAccessToken,
  resolveContaIdFromWebhookAuthToken,
  type TransferAuthorizationWebhookPayload,
} from '@alusa/finance';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = resolveAsaasWebhookAccessToken(req.headers);
    if (!accessToken) {
      return json(401, { status: 'REFUSED', refuseReason: 'Token ausente' });
    }

    const contaId = await resolveContaIdFromWebhookAuthToken(accessToken);
    if (!contaId) {
      return json(401, { status: 'REFUSED', refuseReason: 'Token invalido' });
    }

    const rawBody = await req.text();
    const payload = JSON.parse(rawBody) as TransferAuthorizationWebhookPayload;
    const decision = await handleTransferAuthorizationWebhook({
      contaId,
      rawBody,
      payload,
    });

    return json(200, decision);
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.asaas_transfer_authorization_webhook.failed', route: '/api/webhooks/asaas/transfers/authorize', method: 'POST', requestId: getRequestId(req), error });
    return json(500, { status: 'REFUSED', refuseReason: 'Erro interno' });
  }
}
