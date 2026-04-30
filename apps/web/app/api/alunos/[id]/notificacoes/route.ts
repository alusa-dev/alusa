import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import {
  getAsaasCustomerNotificationPreferences,
  saveAsaasCustomerNotificationPreferences,
  type CustomerNotificationPreferenceInput,
} from '@alusa/lib';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { asaasNotificationPreferenceDTOSchema } from '@/features/configuracoes/notificacoes/asaas/dtos';
import { deriveCustomerNotificationChannelDefaults } from '@/features/configuracoes/notificacoes/asaas/customer-channel-defaults';

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

async function resolveAlunoCustomer(params: {
  alunoId: string;
  contaId: string;
  requestedCustomerId?: string | null;
}) {
  const aluno = await prisma.aluno.findFirst({
    where: { id: params.alunoId, contaId: params.contaId },
    select: {
      id: true,
      nome: true,
      asaasCustomerId: true,
      responsaveis: {
        select: {
          responsavel: {
            select: {
              id: true,
              nome: true,
              financeiro: true,
              asaasCustomerId: true,
            },
          },
        },
      },
      matriculas: {
        orderBy: { createdAt: 'desc' },
        select: {
          responsavelFinanceiro: {
            select: {
              id: true,
              nome: true,
              asaasCustomerId: true,
            },
          },
        },
      },
    },
  });

  if (!aluno) return { status: 'NOT_FOUND' as const };

  const responsavelIds = aluno.responsaveis.map((item) => item.responsavel.id);
  const localCustomers = await prisma.customer.findMany({
    where: {
      contaId: params.contaId,
      OR: [
        { payerType: 'ALUNO', payerId: aluno.id },
        ...(responsavelIds.length
          ? [{ payerType: 'RESPONSAVEL' as const, payerId: { in: responsavelIds } }]
          : []),
      ],
    },
    select: {
      payerType: true,
      payerId: true,
      asaasCustomerId: true,
    },
  });

  const allowedCustomerIds = new Set<string>();
  addCustomerId(allowedCustomerIds, aluno.asaasCustomerId);
  aluno.responsaveis.forEach((item) =>
    addCustomerId(allowedCustomerIds, item.responsavel.asaasCustomerId),
  );
  aluno.matriculas.forEach((matricula) =>
    addCustomerId(allowedCustomerIds, matricula.responsavelFinanceiro?.asaasCustomerId),
  );
  localCustomers.forEach((customer) => addCustomerId(allowedCustomerIds, customer.asaasCustomerId));

  const requested = params.requestedCustomerId?.trim();
  if (requested) {
    if (!allowedCustomerIds.has(requested)) {
      return { status: 'FORBIDDEN_CUSTOMER' as const };
    }
    return { status: 'OK' as const, customerId: requested, aluno };
  }

  const localAlunoCustomer = localCustomers.find(
    (customer) => customer.payerType === 'ALUNO' && customer.payerId === aluno.id,
  );
  const localResponsavelCustomer = localCustomers.find(
    (customer) => customer.payerType === 'RESPONSAVEL' && customer.asaasCustomerId,
  );
  const responsavelFinanceiro = aluno.matriculas.find(
    (matricula) => matricula.responsavelFinanceiro?.asaasCustomerId,
  )?.responsavelFinanceiro;
  const responsavelPrincipal =
    aluno.responsaveis.find((item) => item.responsavel.financeiro)?.responsavel ??
    aluno.responsaveis[0]?.responsavel ??
    null;

  const customerId =
    aluno.asaasCustomerId ??
    localAlunoCustomer?.asaasCustomerId ??
    responsavelFinanceiro?.asaasCustomerId ??
    localResponsavelCustomer?.asaasCustomerId ??
    responsavelPrincipal?.asaasCustomerId ??
    null;

  if (!customerId) {
    return { status: 'NO_CUSTOMER' as const, aluno };
  }

  return { status: 'OK' as const, customerId, aluno };
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }

    const url = new URL(request.url);
    const context = await resolveAlunoCustomer({
      alunoId: params.id,
      contaId: user.contaId,
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
      user.contaId,
      context.customerId,
    );

    return json(200, {
      customerId: context.customerId,
      preferences,
      customerChannelDefaults: deriveCustomerNotificationChannelDefaults(preferences),
    });
  } catch (error) {
    console.error('[alunos/notificacoes][GET]', error);
    return jsonError(500, 'ERRO_INTERNO', (error as Error).message);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
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

    const context = await resolveAlunoCustomer({
      alunoId: params.id,
      contaId: user.contaId,
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
    console.error('[alunos/notificacoes][PUT]', error);
    return jsonError(500, 'ERRO_INTERNO', (error as Error).message);
  }
}
