import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError, z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { createCharge, listCharges, syncPaymentStateFromAsaas } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

const postSchema = z.object({
  cobrancaId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const offset = searchParams.get('offset') ? Number(searchParams.get('offset')) : undefined;

    const data = await listCharges({ contaId: user.contaId, limit, offset });
    return json(200, { data });
  } catch (error) {
    console.error('[Finance Charges][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const payload = postSchema.parse(await req.json());

    const result = await createCharge({
      contaId: user.contaId,
      cobrancaId: payload.cobrancaId,
      actor: { type: 'USER', id: user.id },
    });

    if (!result.success) {
      const status =
        result.error === 'COBRANCA_NAO_ENCONTRADA'
          ? 404
          : result.error === 'KYC_NAO_APROVADO'
            ? 409
          : result.error === 'PAGADOR_NAO_ENCONTRADO' || result.error === 'PAGADOR_SEM_CPF'
            ? 422
          : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
            ? 503
            : result.error === 'DATA_INVALIDA'
              ? 422
              : 400;

      return json(status, { error: result.error });
    }

    let sync: { success: boolean; error?: string; appliedEvent?: string } | null = null;

    if (result.data.asaasPaymentId) {
      try {
        const syncResult = await syncPaymentStateFromAsaas({
          contaId: user.contaId,
          asaasPaymentId: result.data.asaasPaymentId,
          eventName: 'PAYMENT_CREATED',
        });

        sync = syncResult.success
          ? { success: true, appliedEvent: syncResult.appliedEvent }
          : { success: false, error: syncResult.error };
      } catch (error) {
        sync = {
          success: false,
          error: error instanceof Error ? error.message : 'ERRO_SINCRONIZAR_PAGAMENTO',
        };
      }
    }

    return json(200, { data: result.data, sync });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: error.flatten() });
    }

    console.error('[Finance Charges][POST]', error);
    return json(500, { error: 'ERRO_INTERNO', message: error instanceof Error ? error.message : undefined });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
