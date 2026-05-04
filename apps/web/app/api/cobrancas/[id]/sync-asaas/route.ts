import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { cobrancaRouteParamsDTOSchema } from '@/features/financeiro/cobrancas/dtos';
import { syncPaymentStateFromAsaas } from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; contaId?: string; role?: string } | undefined;

    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ success: false, error: 'Não autenticado' }, { status: 401 });
    }

    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json({ success: false, error: 'Sem permissão' }, { status: 403 });
    }

    const { id: cobrancaId } = cobrancaRouteParamsDTOSchema.parse(await params);

    const cobranca = await prisma.cobranca.findFirst({
      where: { id: cobrancaId, matricula: { aluno: { contaId: user.contaId } } },
      select: { asaasPaymentId: true },
    });

    const charge = !cobranca
      ? await prisma.charge.findFirst({
          where: { id: cobrancaId, contaId: user.contaId },
          select: { asaasPaymentId: true },
        })
      : null;

    const paymentId = cobranca?.asaasPaymentId ?? charge?.asaasPaymentId;

    if (!paymentId) {
      return NextResponse.json(
        { success: false, error: 'Cobrança não encontrada ou sem integração Asaas' },
        { status: 404 },
      );
    }

    const syncResult = await syncPaymentStateFromAsaas({
      contaId: user.contaId,
      asaasPaymentId: paymentId,
    });

    if (!syncResult.success) {
      return NextResponse.json(
        { success: false, error: syncResult.error },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Cobrança sincronizada com o estado oficial do Asaas.',
      asaasPaymentId: syncResult.asaasPaymentId,
      paymentStatus: syncResult.paymentStatus,
      appliedEvent: syncResult.appliedEvent,
      invoiceUrl: syncResult.invoiceUrl,
      bankSlipUrl: syncResult.bankSlipUrl,
      transactionReceiptUrl: syncResult.transactionReceiptUrl,
    });
  } catch (error) {
    console.error('[POST /api/cobrancas/[id]/sync-asaas] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Erro ao sincronizar cobrança com o Asaas',
      },
      { status: 500 },
    );
  }
}
