import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getAsaasCustomerNotificationPreferences,
  saveAsaasCustomerNotificationPreferences,
  type CustomerNotificationPreferenceInput,
} from '@alusa/finance';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { asaasNotificationPreferenceDTOSchema } from '@/features/configuracoes/notificacoes/asaas/dtos';
import { deriveCustomerNotificationChannelDefaults } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';
import { apiJsonError } from '@/lib/api/standard-response';
import { resolveAlunoNotificationCustomer } from '@/src/server/finance/customer-notification-scope.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const updateCustomerNotificationsSchema = z.object({
  customerId: z.string().trim().optional(),
  preferences: z
    .array(asaasNotificationPreferenceDTOSchema.extend({ id: z.string().trim().optional() }))
    .min(1),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return apiJsonError(status, code, message, details);
}

async function resolveAuth() {
  return resolveTenantSession();
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await resolveAuth();
    if (!auth.ok) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const url = new URL(request.url);
    const context = await resolveAlunoNotificationCustomer({
      alunoId: rawParams.id,
      contaId: auth.contaId,
      requestedCustomerId: url.searchParams.get('customerId'),
    });

    if (context.status === 'NOT_FOUND') {
      return jsonError(404, 'ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado');
    }
    if (context.status === 'FORBIDDEN_CUSTOMER') {
      return jsonError(403, 'CUSTOMER_FORA_DO_ESCOPO', 'Customer não pertence a este aluno');
    }
    if (context.status === 'NO_CUSTOMER') {
      return jsonError(
        409,
        'CUSTOMER_ASAAS_NAO_ENCONTRADO',
        'Este aluno ainda não possui customer sincronizado no Asaas.',
      );
    }

    const preferences = await getAsaasCustomerNotificationPreferences(
      auth.contaId,
      context.customerId,
    );

    return json(200, {
      customerId: context.customerId,
      preferences,
      customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
    });
  } catch (error) {
    console.error('[alunos/notificacoes][GET]', error);
    return jsonError(500, 'ERRO_INTERNO', 'Não foi possível carregar as preferências de notificação.');
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await resolveAuth();
    if (!auth.ok) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return jsonError(
        403,
        'SEM_PERMISSAO',
        'Apenas usuários financeiros podem editar notificações do customer.',
      );
    }

    const parsed = updateCustomerNotificationsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonError(422, 'PAYLOAD_INVALIDO', 'Payload inválido', parsed.error.flatten());
    }

    const context = await resolveAlunoNotificationCustomer({
      alunoId: rawParams.id,
      contaId: auth.contaId,
      requestedCustomerId: parsed.data.customerId,
    });

    if (context.status === 'NOT_FOUND') {
      return jsonError(404, 'ALUNO_NAO_ENCONTRADO', 'Aluno não encontrado');
    }
    if (context.status === 'FORBIDDEN_CUSTOMER') {
      return jsonError(403, 'CUSTOMER_FORA_DO_ESCOPO', 'Customer não pertence a este aluno');
    }
    if (context.status === 'NO_CUSTOMER') {
      return jsonError(
        409,
        'CUSTOMER_ASAAS_NAO_ENCONTRADO',
        'Este aluno ainda não possui customer sincronizado no Asaas.',
      );
    }

    const preferences = await saveAsaasCustomerNotificationPreferences(
      auth.contaId,
      context.customerId,
      parsed.data.preferences as CustomerNotificationPreferenceInput[],
    );

    return json(200, {
      customerId: context.customerId,
      preferences,
      customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
    });
  } catch (error) {
    console.error('[alunos/notificacoes][PUT]', error);
    return jsonError(500, 'ERRO_INTERNO', 'Não foi possível salvar as preferências de notificação.');
  }
}
