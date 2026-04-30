import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  createSubscription,
  createSubscriptionDTOSchema,
  mapCreateSubscriptionDTOToInput,
  mapCreateSubscriptionOutputToDTO,
  listSubscriptions,
  listSubscriptionsQueryDTOSchema,
  mapListSubscriptionsQueryToInput,
  mapListSubscriptionsOutputToDTO,
} from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

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

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const raw = await req.json().catch(() => null);
    const parsed = createSubscriptionDTOSchema.safeParse(raw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    const headerIdempotencyKey = req.headers.get('x-idempotency-key')?.trim() || undefined;

    if (parsed.data.amount != null && parsed.data.value == null) {
      console.warn('[finance][subscriptions] payload legado "amount" utilizado; prefira "value"');
    }

    const input = mapCreateSubscriptionDTOToInput(parsed.data, {
      contaId: user.contaId,
      actorId: user.id,
      idempotencyKey: headerIdempotencyKey,
    });

    const result = await createSubscription(input);

    if (!result.success) {
      const status =
        result.error === 'FEATURE_DISABLED'
          ? 403
          : result.error === 'KYC_NAO_APROVADO'
            ? 409
          : result.error === 'MATRICULA_NAO_ENCONTRADA' || result.error === 'CONTRATO_NAO_ENCONTRADO'
            ? 404
          : result.error === 'ASSINATURA_CONFLITANTE'
            ? 409
          : result.error === 'PAGADOR_NAO_ENCONTRADO'
            ? 404
          : result.error === 'FORMA_PAGAMENTO_INVALIDA' ||
              result.error === 'PAGADOR_SEM_CPF' ||
              result.error === 'ASAAS_CUSTOMER_INVALIDO' ||
              result.error === 'ERRO_AO_CRIAR_CUSTOMER' ||
              result.error === 'DATA_INVALIDA' ||
              result.error === 'END_DATE_ANTES_DA_PRIMEIRA_COBRANCA'
            ? 422
          : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
            ? 503
          : result.error === 'ERRO_AO_CRIAR_ASSINATURA'
            ? 502
          : 500;

      return json(status, { error: result.error });
    }

    const amountOut = parsed.data.value ?? parsed.data.amount ?? input.value;
    const dto = mapCreateSubscriptionOutputToDTO(result.data, amountOut);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Subscriptions][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const queryRaw = {
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      status: searchParams.get('status') ?? undefined,
    };

    const parsed = listSubscriptionsQueryDTOSchema.safeParse(queryRaw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros de query inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    const input = mapListSubscriptionsQueryToInput(parsed.data, user.contaId);
    const data = await listSubscriptions(input);
    const dto = mapListSubscriptionsOutputToDTO(data, parsed.data);

    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Subscriptions][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
