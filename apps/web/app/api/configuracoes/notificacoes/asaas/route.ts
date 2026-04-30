import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  applyPreferencesToAllCustomers,
  getAsaasNotificationPreferences,
  saveAsaasNotificationPreferences,
  type NotificationPreferenceInput,
} from '@alusa/lib';
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

type SessionUser = { id?: string; role?: string; contaId?: string };
async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return json(403, { error: 'SEM_PERMISSAO' });

    const preferences = await getAsaasNotificationPreferences(user.contaId);
    return json(
      200,
      asaasNotificationPreferencesResultDTOSchema.parse({
        preferences,
        customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
      }),
    );
  } catch (error) {
    console.error('[Config Notificacoes Asaas][GET]', error);
    return json(500, { error: 'ERRO_INTERNO', message: (error as Error).message });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return json(403, { error: 'SEM_PERMISSAO' });

    const parsed = updateAsaasNotificationPreferencesInputDTOSchema.safeParse(await request.json());
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const preferencesPayload = parsed.data.preferences as NotificationPreferenceInput[];
    const preferences = await saveAsaasNotificationPreferences(user.contaId, preferencesPayload);

    return json(
      200,
      saveAsaasNotificationPreferencesResultDTOSchema.parse({ preferences }),
    );
  } catch (error) {
    console.error('[Config Notificacoes Asaas][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO', message: (error as Error).message });
  }
}

export async function POST() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    void applyPreferencesToAllCustomers(user.contaId).catch((error) => {
      console.error('[Config Notificacoes Asaas][POST][ASYNC_SYNC]', error, {
        contaId: user.contaId,
        actorId: user.id,
      });
    });

    return json(202, {
      accepted: true,
      message: 'Sincronização iniciada para os registros existentes.',
    });
  } catch (error) {
    console.error('[Config Notificacoes Asaas][POST]', error);
    return json(500, { error: 'ERRO_INTERNO', message: (error as Error).message });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
