import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  enqueueAsaasNotificationPreferenceSyncForTenant,
  getAsaasNotificationPreferences,
  saveAsaasNotificationPreferences,
  type NotificationPreferenceInput,
} from '@alusa/finance';
import {
  asaasNotificationPreferencesResultDTOSchema,
  saveAsaasNotificationPreferencesResultDTOSchema,
  updateAsaasNotificationPreferencesInputDTOSchema,
} from '@/features/configuracoes/notificacoes/asaas/dtos';
import { deriveCustomerNotificationChannelDefaults } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase()))
      return json(403, { error: 'SEM_PERMISSAO' });

    const preferences = await getAsaasNotificationPreferences(auth.contaId);
    return json(
      200,
      asaasNotificationPreferencesResultDTOSchema.parse({
        preferences,
        customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
      }),
    );
  } catch (error) {
    console.error('[Config Notificacoes Asaas][GET]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível carregar as preferências Asaas.' });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase()))
      return json(403, { error: 'SEM_PERMISSAO' });

    const parsed = updateAsaasNotificationPreferencesInputDTOSchema.safeParse(await request.json());
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const preferencesPayload = parsed.data.preferences as NotificationPreferenceInput[];
    const preferences = await saveAsaasNotificationPreferences(auth.contaId, preferencesPayload);

    return json(
      200,
      saveAsaasNotificationPreferencesResultDTOSchema.parse({ preferences }),
    );
  } catch (error) {
    console.error('[Config Notificacoes Asaas][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível salvar as preferências Asaas.' });
  }
}

export async function POST() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const result = await enqueueAsaasNotificationPreferenceSyncForTenant({
      contaId: auth.contaId,
      reason: 'CONFIGURACAO_GLOBAL_ATUALIZADA',
      limit: 5_000,
    });

    return json(202, {
      accepted: true,
      enqueued: result.enqueued,
      message: 'Sincronização enfileirada. O job recorrente aplicará as preferências com retry controlado.',
    });
  } catch (error) {
    console.error('[Config Notificacoes Asaas][POST]', error);
    return json(500, { error: 'ERRO_INTERNO', message: 'Não foi possível restaurar as preferências Asaas.' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
