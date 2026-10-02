/**
 * API Route: /api/cobrancas/[id]/resend
 *
 * Reenvia cobrança via Asaas (boleto/PIX) para o cliente
 *
 * @module api/cobrancas/[id]/resend
 */

import { NextRequest, NextResponse } from 'next/server';
import { cobrancaRouteParamsDTOSchema } from '@/features/finance/operations/charges/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { ManualSyncError, resendTaxaMatricula } from '@alusa/finance';

import { logFinanceApiError } from '@/lib/api/finance-api-response';
export const dynamic = 'force-dynamic';

/**
 * POST /api/cobrancas/[id]/resend
 *
 * Reenvia link de pagamento para o cliente via Asaas
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id: cobrancaId } = cobrancaRouteParamsDTOSchema.parse(await params);

    const result = await resendTaxaMatricula({
      cobrancaId,
      contaId: auth.contaId,
      actorId: auth.userId,
    });

    return NextResponse.json({
      success: true,
      message: 'Cobrança reenviada com sucesso',
      data: {
        cobrancaId: result.cobrancaId,
        matriculaId: result.matriculaId,
        status: result.newStatus,
        previousStatus: result.previousStatus,
        newTaxaStatus: result.newTaxaStatus ?? null,
        invoiceUrl: result.invoiceUrl ?? null,
        bankSlipUrl: result.bankSlipUrl ?? null,
        pixQrCodeUrl: result.pixQrCode ?? null,
        pixCopyPaste: result.pixCopyPaste ?? null,
      },
    });
  } catch (error) {
    if (error instanceof ManualSyncError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details ?? null,
        },
        { status: error.statusCode },
      );
    }

    logFinanceApiError('/api/cobrancas/[id]/resend', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor',
      },
      { status: 500 },
    );
  }
}
