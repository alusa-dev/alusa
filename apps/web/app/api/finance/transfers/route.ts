import { NextRequest, NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  listTransfers,
  listTransfersQueryDTOSchema,
  mapListTransfersQueryToInput,
  mapListTransfersOutputToDTO,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const capabilityBlock = blockUnavailableFinanceCapability(auth.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const queryRaw = {
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      operation: searchParams.get('operation') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      direction: searchParams.get('direction') ?? undefined,
    };

    const parsed = listTransfersQueryDTOSchema.safeParse(queryRaw);
    if (!parsed.success) {
      return json(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parâmetros de query inválidos',
          details: parsed.error.flatten(),
        },
      });
    }

    const input = mapListTransfersQueryToInput(parsed.data, auth.contaId);
    const data = await listTransfers(input);
    const dto = mapListTransfersOutputToDTO(data, parsed.data);

    return json(200, { data: dto });
  } catch (error) {
    console.error('[Finance Transfers][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
