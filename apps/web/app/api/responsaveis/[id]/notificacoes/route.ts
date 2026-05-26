import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import {
  getAsaasCustomerNotificationPreferences,
  saveAsaasCustomerNotificationPreferences,
  type CustomerNotificationPreferenceInput,
} from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { asaasNotificationPreferenceDTOSchema } from '@/features/configuracoes/notificacoes/asaas/dtos';
import { deriveCustomerNotificationChannelDefaults } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';
import { resolveResponsavelRouteId } from '../../_lib/resolve-responsavel-route-id';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

const updateCustomerNotificationsSchema = z.object({
  customerId: z.string().trim().optional(),
  preferences: z
    .array(asaasNotificationPreferenceDTOSchema.extend({ id: z.string().trim().optional() }))
    .min(1),
});

type SessionUser = {
  id?: string | null;
  role?: string | null;
  contaId?: string | null;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return json(status, { error: { code, message, details } });
}

function addCustomerId(ids: Set<string>, customerId?: string | null) {
  const trimmed = customerId?.trim();
  if (trimmed) ids.add(trimmed);
}

async function resolveAuth() {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

async function resolveResponsavelCustomer(params: {
  responsavelIdOrRouteId: string;
  contaId: string;
  requestedCustomerId?: string | null;
}) {
  const responsavelId = await resolveResponsavelRouteId(
    params.responsavelIdOrRouteId,
    params.contaId,
  );
  if (!responsavelId) return { status: 'NOT_FOUND' as const };

  const responsavel = await prisma.responsavel.findFirst({
    where: { id: responsavelId, contaId: params.contaId },
    select: {
      id: true,
      nome: true,
      asaasCustomerId: true,
    },
  });

  if (!responsavel) return { status: 'NOT_FOUND' as const };

  const localCustomers = await prisma.customer.findMany({
    where: {
      contaId: params.contaId,
      payerType: 'RESPONSAVEL',
      payerId: responsavel.id,
    },
    select: {
      asaasCustomerId: true,
    },
  });

  const allowedCustomerIds = new Set<string>();
  addCustomerId(allowedCustomerIds, responsavel.asaasCustomerId);
  localCustomers.forEach((customer) => addCustomerId(allowedCustomerIds, customer.asaasCustomerId));

  const requested = params.requestedCustomerId?.trim();
  if (requested) {
    if (!allowedCustomerIds.has(requested)) {
      return { status: 'FORBIDDEN_CUSTOMER' as const };
    }
    return { status: 'OK' as const, customerId: requested, responsavel };
  }

  const customerId =
    responsavel.asaasCustomerId ??
    localCustomers.find((customer) => customer.asaasCustomerId)?.asaasCustomerId ??
    null;

  if (!customerId) {
    return { status: 'NO_CUSTOMER' as const, responsavel };
  }

  return { status: 'OK' as const, customerId, responsavel };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const url = new URL(request.url);
    const context = await resolveResponsavelCustomer({
      responsavelIdOrRouteId: rawParams.id,
      contaId: user.contaId,
      requestedCustomerId: url.searchParams.get('customerId'),
    });

    if (context.status === 'NOT_FOUND') {
      return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável não encontrado');
    }
    if (context.status === 'FORBIDDEN_CUSTOMER') {
      return jsonError(403, 'CUSTOMER_FORA_DO_ESCOPO', 'Customer não pertence a este responsável');
    }
    if (context.status === 'NO_CUSTOMER') {
      return jsonError(
        409,
        'CUSTOMER_ASAAS_NAO_ENCONTRADO',
        'Este responsável ainda não possui customer sincronizado no Asaas.',
      );
    }

    const preferences = await getAsaasCustomerNotificationPreferences(
      user.contaId,
      context.customerId,
    );

    return json(200, {
      customerId: context.customerId,
      preferences,
      customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
    });
  } catch (error) {
    console.error('[responsaveis/notificacoes][GET]', error);
    return jsonError(500, 'ERRO_INTERNO', (error as Error).message);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
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

    const context = await resolveResponsavelCustomer({
      responsavelIdOrRouteId: rawParams.id,
      contaId: user.contaId,
      requestedCustomerId: parsed.data.customerId,
    });

    if (context.status === 'NOT_FOUND') {
      return jsonError(404, 'RESPONSAVEL_NAO_ENCONTRADO', 'Responsável não encontrado');
    }
    if (context.status === 'FORBIDDEN_CUSTOMER') {
      return jsonError(403, 'CUSTOMER_FORA_DO_ESCOPO', 'Customer não pertence a este responsável');
    }
    if (context.status === 'NO_CUSTOMER') {
      return jsonError(
        409,
        'CUSTOMER_ASAAS_NAO_ENCONTRADO',
        'Este responsável ainda não possui customer sincronizado no Asaas.',
      );
    }

    const preferences = await saveAsaasCustomerNotificationPreferences(
      user.contaId,
      context.customerId,
      parsed.data.preferences as CustomerNotificationPreferenceInput[],
    );

    return json(200, {
      customerId: context.customerId,
      preferences,
      customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
    });
  } catch (error) {
    console.error('[responsaveis/notificacoes][PUT]', error);
    return jsonError(500, 'ERRO_INTERNO', (error as Error).message);
  }
}
