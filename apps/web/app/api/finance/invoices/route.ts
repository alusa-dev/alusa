import { NextRequest, NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { assertPlatformAccessForConta, platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';
import {
  scheduleChargeInvoice,
  createInvoiceDTOSchema,
  mapCreateInvoiceOutputToDTO,
  listInvoices,
  listInvoicesQueryDTOSchema,
  mapListInvoicesQueryToInput,
  mapListInvoicesOutputToDTO,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });
    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'CHARGE_CREATE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return json(blocked.status, blocked.body);
      throw error;
    }

    const gate = await guardFinancialAccountOr412(auth.contaId);
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

    const result = await scheduleChargeInvoice({
      contaId: auth.contaId,
      chargeId: parsed.data.chargeId,
      serviceDescription: parsed.data.serviceDescription,
      observations: parsed.data.observations,
      deductions: parsed.data.deductions,
      effectiveDate: parsed.data.effectiveDate,
      actor: { type: 'USER', id: auth.userId },
    });

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
                : typeof result.error === 'object' && result.error.kind === 'VALIDATION'
                  ? 422
                  : typeof result.error === 'object' && result.error.status
                    ? result.error.status
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
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
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

    const input = mapListInvoicesQueryToInput(parsed.data, auth.contaId);
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
