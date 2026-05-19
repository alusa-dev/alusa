/**
 * API Route: /api/cobrancas/[id]/resend
 *
 * Reenvia cobrança via Asaas (boleto/PIX) para o cliente
 *
 * @module api/cobrancas/[id]/resend
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { ManualSyncError, resendTaxaMatricula } from '@alusa/finance';

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
    const rawParams = await params;
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; contaId?: string } })?.user;

    if (!user?.id || !user?.contaId) {
      console.warn('[COBRANCA_RESEND] Usuário não autenticado');
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const cobrancaId = rawParams.id;

    const result = await resendTaxaMatricula({
      cobrancaId,
      contaId: user.contaId,
      actorId: user.id,
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

    console.error('[COBRANCA_RESEND] Erro inesperado', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor',
      },
      { status: 500 },
    );
  }
}
