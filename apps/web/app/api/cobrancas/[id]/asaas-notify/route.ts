import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getAsaasPaymentDetails } from '@alusa/finance';
import { prisma } from '@/lib/prisma';
import {
  cobrancaNotifyInputDTOSchema,
  cobrancaNotifyResultDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaNotifyResultToDTO } from '@/features/financeiro/cobrancas/mappers';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/**
 * POST /api/cobrancas/[id]/asaas-notify
 * 
 * Obtém os links oficiais da cobrança já existente no Asaas.
 *
 * O contrato atual da API pública não expõe mais POST /payments/{id}/notifications,
 * então esta ação precisa ser tratada como refresh/leitura dos links oficiais.
 * 
 * FASE 6: Validação de tenant + RBAC
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; contaId?: string; role?: string } | undefined;

    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    const { id: cobrancaId } = cobrancaRouteParamsDTOSchema.parse(await params);
    const body = await req.json();
    const parsed = cobrancaNotifyInputDTOSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', details: parsed.error },
        { status: 400 },
      );
    }

    // Validar que a cobrança pertence ao tenant
    const cobranca = await prisma.cobranca.findFirst({
      where: { id: cobrancaId, matricula: { aluno: { contaId: user.contaId } } },
      select: { asaasPaymentId: true },
    });

    // Também verificar em Charge (standalone)
    const charge = !cobranca
      ? await prisma.charge.findFirst({
          where: { id: cobrancaId, contaId: user.contaId },
          select: { asaasPaymentId: true },
        })
      : null;

    const paymentId = cobranca?.asaasPaymentId ?? charge?.asaasPaymentId;

    if (!paymentId) {
      return NextResponse.json(
        { error: 'Cobrança não encontrada ou sem integração Asaas' },
        { status: 404 },
      );
    }

    const { tipo } = parsed.data;

    console.log(`[Asaas Notify] Obtendo links oficiais para payment: ${paymentId}`);

    const result = await getAsaasPaymentDetails({
      contaId: user.contaId,
      paymentId,
      includePixQrCode: true,
    });

    return NextResponse.json(
      cobrancaNotifyResultDTOSchema.parse(
        mapCobrancaNotifyResultToDTO({
          success: true,
          message: 'Links oficiais da cobrança obtidos com sucesso.',
          tipo,
          invoiceUrl: result.payment.invoiceUrl ?? undefined,
          bankSlipUrl: result.payment.bankSlipUrl ?? undefined,
          pixQrCodeUrl: result.pixQrCode?.encodedImage
            ? `data:image/png;base64,${result.pixQrCode.encodedImage}`
            : undefined,
          pixCopyPaste: result.pixQrCode?.payload ?? undefined,
        }),
      ),
    );
  } catch (error) {
    console.error('[POST /api/cobrancas/[id]/asaas-notify] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erro ao enviar notificação' 
      },
      { status: 500 },
    );
  }
}

