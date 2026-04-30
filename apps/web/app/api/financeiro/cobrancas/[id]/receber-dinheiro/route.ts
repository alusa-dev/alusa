import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  AsaasEnvError,
  KycNotApprovedError,
  confirmCashPayment,
  getCurrentBrasiliaDate,
  isAsaasEnabled,
  readPaymentStatusPreflight,
  auditLogService,
} from '@alusa/finance';
import { randomUUID } from 'crypto';
import {
  cobrancaActionResultDTOSchema,
  cobrancaConfirmarRecebimentoInputDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaActionResultToDTO } from '@/features/financeiro/cobrancas/mappers';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/**
 * POST /api/financeiro/cobrancas/[id]/receber-dinheiro
 * 
 * Confirma recebimento de cobrança em dinheiro
 * Sincroniza com Asaas usando data atual
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID();
  const startedAt = Date.now();

  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    
    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Usuário não autenticado' }, { status: 401 });
    }
    
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(await params);
    const body = cobrancaConfirmarRecebimentoInputDTOSchema.parse(
      await _req.json().catch(() => ({})),
    );
    const notifyCustomer = typeof body?.notifyCustomer === 'boolean' ? body.notifyCustomer : undefined;
    const dataPagamentoRaw = typeof body?.dataPagamento === 'string' ? body.dataPagamento : undefined;
    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId: user.contaId } } },
      include: {
        matricula: {
          select: {
            id: true,
            aluno: {
              select: {
                contaId: true,
              },
            },
          },
        },
      },
    });
    
    if (!cobranca || !cobranca.asaasPaymentId) {
      return NextResponse.json(
        { error: 'Cobrança não encontrada ou sem integração Asaas.', correlationId },
        { status: 404 },
      );
    }

    if (!isAsaasEnabled()) {
      return NextResponse.json(
        { error: 'Integração Asaas desabilitada', correlationId },
        { status: 503 },
      );
    }

    const asaasPayment = await readPaymentStatusPreflight(cobranca.asaasPaymentId, { contaId: user.contaId });

    if (asaasPayment.status === 'RECEIVED_IN_CASH') {
      await auditLogService.record({
        contaId: user.contaId,
        action: 'finance.charge.receive_in_cash_idempotent',
        entity: { type: 'Cobranca', id },
        metadata: {
          correlationId,
          asaasPaymentId: cobranca.asaasPaymentId,
          asaasStatus: asaasPayment.status,
          requestedBy: user.id,
          requestedByRole: user.role,
          durationMs: Date.now() - startedAt,
        },
      });

      return NextResponse.json(
        cobrancaActionResultDTOSchema.parse(
          mapCobrancaActionResultToDTO({
            success: true,
            pending: false,
            alreadyReceived: true,
            message: 'Cobrança já estava confirmada como recebida em dinheiro no Asaas.',
            correlationId,
          }),
        ),
        { status: 200 },
      );
    }

    const allowedStatuses = new Set(['PENDING', 'OVERDUE']);
    if (!allowedStatuses.has(asaasPayment.status)) {
      return NextResponse.json(
        {
          error: `Operação não permitida. Status atual no Asaas: ${asaasPayment.status}`,
          correlationId,
          asaasStatus: asaasPayment.status,
        },
        { status: 409 },
      );
    }

    // ✅ Obter data atual no timezone de Brasília (timezone-safe)
    const brasiliaDate = getCurrentBrasiliaDate();
    const isValidDate = (value?: string): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const paymentDateStr: string = isValidDate(dataPagamentoRaw) ? dataPagamentoRaw : brasiliaDate.dateStr;
    const paymentDateObj = isValidDate(dataPagamentoRaw)
      ? new Date(`${dataPagamentoRaw}T12:00:00.000Z`)
      : brasiliaDate.dateObj;

    console.log('[Receber Dinheiro] Confirmando pagamento:', {
      cobrancaId: id,
      asaasPaymentId: cobranca.asaasPaymentId,
      paymentDateStr,
      paymentDateObj,
      valor: Number(cobranca.valor),
      brasiliaDateComponents: { year: brasiliaDate.year, month: brasiliaDate.month, day: brasiliaDate.day },
    });

    // ✅ Usar data obtida no timezone de Brasília (timezone-safe)
    await confirmCashPayment(
      cobranca.asaasPaymentId,
      paymentDateStr,
      Number(cobranca.valor),
      notifyCustomer,
      { contaId: user.contaId }
    );

    console.log('[Receber Dinheiro] Pagamento confirmado no Asaas');

    await auditLogService.record({
      contaId: user.contaId,
      action: 'finance.charge.receive_in_cash_requested',
      entity: { type: 'Cobranca', id },
      metadata: {
        correlationId,
        asaasPaymentId: cobranca.asaasPaymentId,
        requestedBy: user.id,
        requestedByRole: user.role,
        paymentDateStr,
        valor: Number(cobranca.valor),
        notifyCustomer,
        durationMs: Date.now() - startedAt,
      },
    });

    await prisma.logFinanceiro.create({
      data: {
        contaId: user.contaId,
        usuarioId: user.id,
        acao: 'CONFIRMAR_MANUAL',
        detalhes: {
          cobrancaId: id,
          asaasPaymentId: cobranca.asaasPaymentId,
          correlationId,
          paymentDateStr,
          paymentDateObj: paymentDateObj.toISOString(),
          valor: Number(cobranca.valor),
          confirmedBy: user.id,
          confirmedByRole: user.role,
          confirmedAt: new Date().toISOString(),
          notifyCustomer,
        },
      },
    });

    console.log('[Receber Dinheiro] Processo concluído com sucesso');

    return NextResponse.json(
      cobrancaActionResultDTOSchema.parse(
        mapCobrancaActionResultToDTO({
          success: true,
          pending: true,
          message: 'Solicitação enviada. O status será atualizado via webhook do Asaas.',
          correlationId,
          data: {
            cobrancaId: id,
            paymentDateStr,
          },
        }),
      ),
      { status: 202 },
    );
  } catch (e) {
    const error = e as Error;
    console.error('[Receber Dinheiro] Erro ao confirmar pagamento:', error);

    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras', correlationId },
        { status: 409 },
      );
    }

    if (error instanceof AsaasEnvError) {
      return NextResponse.json(
        { error: 'ASAAS_INDISPONIVEL', message: 'Credenciais Asaas não configuradas', correlationId },
        { status: 503 },
      );
    }
    
    return NextResponse.json({ 
      error: 'Erro ao confirmar pagamento em dinheiro',
      message: error.message,
      correlationId,
    }, { status: 500 });
  }
}
