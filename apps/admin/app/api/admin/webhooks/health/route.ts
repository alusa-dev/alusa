import { NextResponse } from 'next/server';

import { requireSupportApi } from '@/features/support/api/support-api.server';
import { checkWebhookHealth } from '@alusa/finance';

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, {
    roles: ['SUPPORT_VIEWER', 'SUPPORT_FINANCE', 'SUPPORT_DEVELOPER', 'SUPPORT_ADMIN', 'BREAK_GLASS'],
    scope: 'admin-webhook-health',
  });
  if (!auth.ok) return auth.response;

  try {
    const result = await checkWebhookHealth({ autoRecover: false });
    const message = result.interruptedFound > 0
      ? `${result.interruptedFound} webhook(s) interrompido(s) foram detectados. A configuração precisa ser reparada.`
      : `Verificação concluída em ${result.checkedAccounts} conta(s). Nenhum webhook interrompido foi detectado.`;

    return NextResponse.json(
      { success: true, message, data: result },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Falha ao verificar a saúde dos webhooks.' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
}
