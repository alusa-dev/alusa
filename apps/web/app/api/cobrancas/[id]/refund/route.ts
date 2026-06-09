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
  evaluatePaymentActionPolicy,
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  markPaymentCommandSent,
  registerPaymentCommand,
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

function resolveAcademicPaymentOrigin(tipo?: string | null) {
  switch (tipo) {
    case 'PARCELADA':
      return 'INSTALLMENT';
    case 'RECORRENTE':
      return 'SUBSCRIPTION';
    case 'TAXA_MATRICULA':
      return 'ENROLLMENT_FEE';
    case 'AVULSA':
      return 'STANDALONE';
    default:
      return 'ACADEMIC';
  }
}

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
        charge: {
          select: {
            invoiceUrl: true,
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
            billingType: true,
            invoiceUrl: true,
            standaloneInstallmentPlanId: true,
            standaloneSubscriptionId: true,
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
    const policy = evaluatePaymentActionPolicy({
      entityType: cobranca ? 'COBRANCA' : 'CHARGE',
      origin: cobranca
        ? resolveAcademicPaymentOrigin(cobranca.tipo)
        : charge?.standaloneInstallmentPlanId
          ? 'INSTALLMENT'
          : charge?.standaloneSubscriptionId
            ? 'SUBSCRIPTION'
            : 'STANDALONE',
      localStatus: cobranca?.status ?? charge?.status ?? null,
      asaasStatus: asaasPayment.status,
      billingType: asaasPayment.billingType ?? charge?.billingType ?? null,
      hasAsaasPaymentId: true,
      hasInvoiceUrl: Boolean(cobranca?.charge?.invoiceUrl || charge?.invoiceUrl || asaasPayment.invoiceUrl),
      wasReceivedInCash: asaasPayment.status === 'RECEIVED_IN_CASH',
      isInstallmentPayment: cobranca?.tipo === 'PARCELADA' || Boolean(charge?.standaloneInstallmentPlanId),
      isSubscriptionPayment: cobranca?.tipo === 'RECORRENTE' || Boolean(charge?.standaloneSubscriptionId),
      paymentValue: asaasPayment.value ?? Number(cobranca?.valor ?? charge?.value ?? 0),
      refundedValue:
        Array.isArray((asaasPayment as { refunds?: Array<{ value?: number; status?: string }> }).refunds)
          ? (asaasPayment as { refunds?: Array<{ value?: number; status?: string }> }).refunds!
              .filter((refund) => refund.status !== 'CANCELLED')
              .reduce((sum, refund) => sum + Number(refund.value ?? 0), 0)
          : Number(cobranca?.estornadoValor ?? 0),
    });

    if (!policy.canRefund) {
      const decision = policy.actions.REFUND;
      return NextResponse.json(
        {
          error: decision.reason ?? 'Operação de estorno não permitida.',
          correlationId,
          asaasStatus: asaasPayment.status,
          code: decision.code,
          ...(decision.hint ? { hint: decision.hint } : {}),
          ...(decision.code === 'REFUND_NOT_ALLOWED_FOR_CASH_PAYMENT'
            ? { expectedAction: 'UNDO_CASH_PAYMENT' }
            : {}),
        },
        { status: 400 },
      );
    }

    if (body.value !== undefined && !policy.canPartialRefund) {
      const decision = policy.actions.PARTIAL_REFUND;
      return NextResponse.json(
        {
          error: decision.reason ?? 'Estorno parcial não permitido.',
          correlationId,
          asaasStatus: asaasPayment.status,
          code: decision.code,
          ...(decision.hint ? { hint: decision.hint } : {}),
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

    const command = await registerPaymentCommand({
      contaId: user.contaId,
      type: 'PAYMENT_REFUND_COMMAND',
      entityType: cobranca ? 'COBRANCA' : 'CHARGE',
      entityId: cobranca?.id ?? charge!.id,
      asaasPaymentId,
      expectedEvents: expectedEventsForPaymentCommand('PAYMENT_REFUND_COMMAND'),
      correlationId,
      actorId: user.id,
      chargeId: charge?.id ?? null,
      cobrancaId: cobranca?.id ?? null,
      metadata: {
        source: 'POST /api/cobrancas/[id]/refund',
        previousAsaasStatus: asaasPayment.status,
        refundValue: refundValue ?? paymentValue,
        isPartialRefund: refundValue !== undefined && refundValue < paymentValue,
        splitRefunds: body.splitRefunds ?? null,
      },
    });

    // Executar comando no Asaas
    try {
      await refundCobranca({
        paymentId: asaasPaymentId,
        contaId: user.contaId,
        value: refundValue,
        description: body.description || `Estorno solicitado via Alusa - ${correlationId}`,
        splitRefunds: body.splitRefunds,
      });
      await markPaymentCommandSent({
        jobId: command.id,
        providerStatus: asaasPayment.status,
      });
    } catch (commandError) {
      await failPaymentCommand({ jobId: command.id, error: commandError });
      throw commandError;
    }

    try {
      await syncPaymentStateFromAsaas({
        contaId: user.contaId,
        asaasPaymentId,
      });
    } catch (syncError) {
      console.warn('[Refund] Falha ao sincronizar estado pós-comando', {
        correlationId,
        commandJobId: command.id,
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
          commandJobId: command.id,
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
