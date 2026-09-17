import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiErrorResponse } from '@/lib/api/report-api-error';
import { getAsaasPaymentDetails } from '@alusa/finance';
import {
  financeiroLancamentoReciboResultDTOSchema,
  financeiroRouteIdParamsDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroLancamentoReciboResultToDTO } from '@/features/financeiro/mappers';
import { getLancamentoReceiptSource } from '@/src/server/finance/lancamento-read.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { id } = financeiroRouteIdParamsDTOSchema.parse(await params);

    const lancamento = await getLancamentoReceiptSource({ contaId: auth.contaId, lancamentoId: id });

    if (!lancamento) return err(404, 'NAO_ENCONTRADO', 'Lancamento nao encontrado');

    if (lancamento.anexoUrl) {
      return NextResponse.json(
        financeiroLancamentoReciboResultDTOSchema.parse(
          mapFinanceiroLancamentoReciboResultToDTO({
            data: { receiptUrl: lancamento.anexoUrl, invoiceUrl: null },
          }),
        ),
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }

    const ref = lancamento.externalRef;
    const prefix = 'asaas:payment:';
    if (!ref || !ref.startsWith(prefix)) {
      return err(404, 'RECIBO_NAO_DISPONIVEL', 'Comprovante nao disponivel');
    }

    const paymentId = ref.slice(prefix.length).trim();
    if (!paymentId) {
      return err(400, 'EXTERNAL_REF_INVALIDA', 'ExternalRef invalida');
    }

    const { payment } = await getAsaasPaymentDetails({
      contaId: auth.contaId,
      paymentId,
      includePixQrCode: false,
    });

    const receiptUrl = payment.transactionReceiptUrl ?? null;
    const invoiceUrl = payment.invoiceUrl ?? null;

    if (!receiptUrl && !invoiceUrl) {
      return err(404, 'RECIBO_NAO_DISPONIVEL', 'Comprovante nao disponivel');
    }

    return NextResponse.json(
      financeiroLancamentoReciboResultDTOSchema.parse(
        mapFinanceiroLancamentoReciboResultToDTO({
          data: { receiptUrl, invoiceUrl },
        }),
      ),
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return apiErrorResponse(e, {
      route: 'GET /api/financeiro/lancamentos/[id]/recibo',
      fallbackMessage: 'Não foi possível carregar o comprovante.',
    });
  }
}
