import { NextRequest, NextResponse } from 'next/server';

import { financeInstallmentRouteParamsDTOSchema } from '@/features/finance/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiErrorResponse } from '@/lib/api/report-api-error';
import {
  KycNotApprovedError,
} from '@alusa/finance';
import { cancelInstallmentForTenant } from '@/src/server/finance/installment-cancellation.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rawParams = await params;
    const parsedParams = financeInstallmentRouteParamsDTOSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return err(400, 'PARAMETROS_INVALIDOS', 'Parcelamento inválido');
    }
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const result = await cancelInstallmentForTenant({
      contaId: auth.contaId,
      planId: parsedParams.data.id,
    });
    if (result.status === 'NOT_FOUND') return err(404, 'NAO_ENCONTRADO', 'Parcelamento não encontrado');
    if (result.status === 'WITHOUT_ASAAS_LINK') {
      return err(400, 'SEM_VINCULO_ASAAS', 'Parcelamento sem vínculo com a plataforma financeira');
    }

    return NextResponse.json(
      {
        success: true,
        message: result.message,
        ...(result.data ? { data: result.data } : {}),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof KycNotApprovedError) {
      return err(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }

    return apiErrorResponse(e, {
      route: 'DELETE /api/finance/installments/[id]/payments',
      fallbackMessage: 'Não foi possível cancelar o parcelamento.',
    });
  }
}
