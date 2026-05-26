import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  KycNotApprovedError,
  refundCobranca,
  isAsaasEnabled,
  readPaymentFullPreflight,
  auditLogService,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import { AsaasHttpError } from '@alusa/finance';
import { randomUUID } from 'crypto';
import {
  cobrancaActionResultDTOSchema,
  cobrancaRefundInputDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaActionResultToDTO } from '@/features/financeiro/cobrancas/mappers';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

// Status do Asaas que permitem estorno
const REFUNDABLE_STATUSES = new Set([
  'RECEIVED',
  'CONFIRMED',
  'DUNNING_RECEIVED',
]);

/**
 * POST /api/cobrancas/[id]/refund
 *
 * Estorna uma cobrança paga (total ou parcial).
 *
 * Invariantes:
 * - Read-before-write: verifica estado atual no Asaas antes de executar
 * - Apenas cobranças pagas podem ser estornadas
 * - Status final só muda via webhook (aqui aplicamos estado intermediário)
 * - Registra correlationId para auditoria
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const body = cobrancaRefundInputDTOSchema.parse(await req.json().catch(() => ({})));

    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId: user.contaId } } },
      include: {
        matricula: {
          select: {
            id: true,
            aluno: { select: { contaId: true } },
          },
        },
      },
    });

    const charge = !cobranca
      ? await prisma.charge.findFirst({
          where: { id, contaId: user.contaId },
          select: {
            id: true,
            status: true,
            asaasPaymentId: true,
            value: true,
          },
        })
      : null;

    if (!cobranca && !charge) {
      return NextResponse.json(
        { error: 'Cobrança não encontrada', correlationId },
        { status: 404 },
      );
    }

    const asaasPaymentId = cobranca?.asaasPaymentId ?? charge?.asaasPaymentId ?? null;
    if (!asaasPaymentId) {
      return NextResponse.json(
        { error: 'Cobrança sem integração com a plataforma financeira', correlationId },
        { status: 400 },
      );
    }

    if (!isAsaasEnabled()) {
      return NextResponse.json(
        { error: 'Integração financeira desabilitada', correlationId },
        { status: 503 },
      );
    }

    // Read-before-write: verificar estado atual no Asaas
    const asaasPayment = await readPaymentFullPreflight(asaasPaymentId, { contaId: user.contaId });

    if (asaasPayment.status === 'RECEIVED_IN_CASH') {
      return NextResponse.json(
        {
          error: 'Cobranças recebidas em dinheiro devem usar a ação de desfazer recebimento.',
          correlationId,
          asaasStatus: asaasPayment.status,
          expectedAction: 'UNDO_CASH_PAYMENT',
        },
        { status: 400 },
      );
    }

    if (!REFUNDABLE_STATUSES.has(asaasPayment.status)) {
      return NextResponse.json(
        {
          error: `Operação não permitida. Status atual na plataforma financeira: ${asaasPayment.status}`,
          correlationId,
          asaasStatus: asaasPayment.status,
          allowedStatuses: Array.from(REFUNDABLE_STATUSES),
        },
        { status: 400 },
      );
    }

    // Validar valor do estorno (se parcial)
    const refundValue = body.value;
    const paymentValue = asaasPayment.value ?? Number(cobranca?.valor ?? charge?.value ?? 0);

    if (refundValue !== undefined) {
      if (refundValue <= 0) {
        return NextResponse.json(
          { error: 'Valor do estorno deve ser maior que zero', correlationId },
          { status: 400 },
        );
      }
      if (refundValue > paymentValue) {
        return NextResponse.json(
          {
            error: 'Valor do estorno não pode ser maior que o valor pago',
            correlationId,
            paymentValue,
            requestedValue: refundValue,
          },
          { status: 400 },
        );
      }
    }

    // Executar comando no Asaas
    await refundCobranca({
      paymentId: asaasPaymentId,
      contaId: user.contaId,
      value: refundValue,
      description: body.description || `Estorno solicitado via Alusa - ${correlationId}`,
      splitRefunds: body.splitRefunds,
    });

    try {
      await syncPaymentStateFromAsaas({
        contaId: user.contaId,
        asaasPaymentId,
      });
    } catch (syncError) {
      console.warn('[Refund] Falha ao sincronizar estado pós-comando', {
        correlationId,
        asaasPaymentId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    // Registrar auditoria (status final virá via webhook)
    await auditLogService.record({
      contaId: user.contaId,
      action: 'finance.charge.refund_requested',
      entity: { type: cobranca ? 'Cobranca' : 'Charge', id: cobranca?.id ?? charge!.id },
      metadata: {
        correlationId,
        asaasPaymentId,
        previousAsaasStatus: asaasPayment.status,
        refundValue: refundValue ?? paymentValue,
        isPartialRefund: refundValue !== undefined && refundValue < paymentValue,
        description: body.description,
        requestedBy: user.id,
        requestedByRole: user.role,
        durationMs: Date.now() - startedAt,
      },
    });

    // Registrar log financeiro
    await prisma.logFinanceiro.create({
      data: {
        contaId: user.contaId,
        usuarioId: user.id,
        cobrancaId: cobranca?.id ?? null,
        acao: 'ESTORNAR_COBRANCA',
        detalhes: {
          cobrancaId: id,
          entityType: cobranca ? 'COBRANCA' : 'CHARGE',
          asaasPaymentId,
          correlationId,
          previousAsaasStatus: asaasPayment.status,
          refundValue: refundValue ?? paymentValue,
          isPartialRefund: refundValue !== undefined && refundValue < paymentValue,
          description: body.description,
        },
      },
    });

    // Retornar 202 Accepted - status final virá via webhook
    return NextResponse.json(
      cobrancaActionResultDTOSchema.parse(
        mapCobrancaActionResultToDTO({
          success: true,
          message: 'Estorno solicitado. Status será atualizado via webhook.',
          pending: true,
          correlationId,
          refundValue: refundValue ?? paymentValue,
        }),
      ),
      { status: 202 },
    );
  } catch (e) {
    const error = e as Error;
    console.error('[Refund] Erro:', error);

    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras', correlationId },
        { status: 409 },
      );
    }

    if (error instanceof AsaasHttpError && error.status >= 400 && error.status < 500) {
      return NextResponse.json(
        {
          error: 'Operação de estorno rejeitada pela plataforma financeira',
          message: error.message,
          correlationId,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: 'Erro ao estornar cobrança',
        message: error.message,
        correlationId,
      },
      { status: 500 },
    );
  }
}
