import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  createInvoice,
  createInvoiceDTOSchema,
  mapCreateInvoiceDTOToInput,
  mapCreateInvoiceOutputToDTO,
  listInvoices,
  listInvoicesQueryDTOSchema,
  mapListInvoicesQueryToInput,
  mapListInvoicesOutputToDTO,
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
    const parsed = createInvoiceDTOSchema.safeParse(raw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    const input = mapCreateInvoiceDTOToInput(parsed.data, {
      contaId: user.contaId,
      actorId: user.id,
    });

    const result = await createInvoice(input);

    if (!result.success) {
      const status =
        result.error === 'FEATURE_DISABLED'
          ? 403
          : result.error === 'KYC_NAO_APROVADO'
            ? 409
          : result.error === 'CHARGE_NAO_ENCONTRADO'
            ? 404
            : result.error === 'CHARGE_SEM_PAGAMENTO_ASAAS'
              ? 409
              : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
                ? 503
                : 500;

      return json(status, { error: result.error });
    }

    const dto = mapCreateInvoiceOutputToDTO(result.data);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Invoices][POST]', error);
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

    const parsed = listInvoicesQueryDTOSchema.safeParse(queryRaw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros de query inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    const input = mapListInvoicesQueryToInput(parsed.data, user.contaId);
    const data = await listInvoices(input);
    const dto = mapListInvoicesOutputToDTO(data, parsed.data);

    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Invoices][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
