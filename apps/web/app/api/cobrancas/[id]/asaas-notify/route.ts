import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getAsaasPaymentDetails } from '@alusa/finance';
import {
  cobrancaNotifyInputDTOSchema,
  cobrancaNotifyResultDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaNotifyResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import { resolveCobrancaPaymentLookupForTenant } from '@/src/server/finance/resolve-cobranca-payment-lookup';

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
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
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

    const paymentLookup = await resolveCobrancaPaymentLookupForTenant(auth.contaId, cobrancaId);
    const paymentId = paymentLookup?.asaasPaymentId ?? null;

    if (!paymentId) {
      return NextResponse.json(
        { error: 'Cobrança não encontrada ou sem integração Asaas' },
        { status: 404 },
      );
    }

    const { tipo } = parsed.data;

    console.log(`[Asaas Notify] Obtendo links oficiais para payment: ${paymentId}`);

    const result = await getAsaasPaymentDetails({
      contaId: auth.contaId,
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
        error: 'Erro ao enviar notificação'
      },
      { status: 500 },
    );
  }
}
