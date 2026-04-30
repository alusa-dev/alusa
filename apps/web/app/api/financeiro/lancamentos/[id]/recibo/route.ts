import { NextRequest, NextResponse } from 'next/server';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { prisma } from '@/src/prisma';
import { getAsaasPaymentDetails } from '@alusa/finance';
import {
  financeiroLancamentoReciboResultDTOSchema,
  financeiroRouteIdParamsDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroLancamentoReciboResultToDTO } from '@/features/financeiro/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SessUser = { id?: string; contaId?: string; role?: string };
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await safeGetServerSession();
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuario nao autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { id } = financeiroRouteIdParamsDTOSchema.parse(params);

    const lancamento = await prisma.lancamento.findFirst({
      where: { id, contaId: user.contaId },
      select: { anexoUrl: true, externalRef: true },
    });

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
      contaId: user.contaId,
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
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
