import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  KycNotApprovedError,
  undoCashPayment,
  isAsaasEnabled,
  readPaymentStatusPreflight,
  auditLogService,
  syncPaymentStateFromAsaas,
  evaluatePaymentActionPolicy,
  expectedEventsForPaymentCommand,
  failPaymentCommand,
  markPaymentCommandSent,
  registerPaymentCommand,
} from '@alusa/finance';
import { randomUUID } from 'crypto';
import {
  cobrancaActionResultDTOSchema,
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
 * POST /api/cobrancas/[id]/undo-receive-in-cash
 *
 * Desfaz o recebimento em dinheiro de uma cobrança.
 *
 * Invariantes:
 * - Read-before-write: verifica estado atual no Asaas antes de executar
 * - Apenas cobranças com status RECEIVED_IN_CASH podem ter recebimento desfeito
 * - Status final só muda via webhook (aqui aplicamos estado intermediário)
 * - Registra correlationId para auditoria
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
        { error: 'Cobrança sem integração Asaas', correlationId },
        { status: 400 },
      );
    }

    if (!isAsaasEnabled()) {
      return NextResponse.json(
        { error: 'Integração Asaas desabilitada', correlationId },
        { status: 503 },
      );
    }

    // Read-before-write: verificar estado atual no Asaas
    const asaasPayment = await readPaymentStatusPreflight(asaasPaymentId, { contaId: user.contaId });
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
      billingType: charge?.billingType ?? null,
      hasAsaasPaymentId: true,
      hasInvoiceUrl: Boolean(cobranca?.charge?.invoiceUrl || charge?.invoiceUrl),
      wasReceivedInCash: asaasPayment.status === 'RECEIVED_IN_CASH',
      isInstallmentPayment: cobranca?.tipo === 'PARCELADA' || Boolean(charge?.standaloneInstallmentPlanId),
      isSubscriptionPayment: cobranca?.tipo === 'RECORRENTE' || Boolean(charge?.standaloneSubscriptionId),
    });

    if (!policy.canUndoCashPayment) {
      const decision = policy.actions.UNDO_CASH_PAYMENT;
      return NextResponse.json(
        {
          error: decision.reason ?? `Operação não permitida. Status atual no Asaas: ${asaasPayment.status}`,
          correlationId,
          asaasStatus: asaasPayment.status,
          code: decision.code,
          ...(decision.hint ? { hint: decision.hint } : {}),
        },
        { status: 400 },
      );
    }

    const command = await registerPaymentCommand({
      contaId: user.contaId,
      type: 'PAYMENT_UNDO_CASH_COMMAND',
      entityType: cobranca ? 'COBRANCA' : 'CHARGE',
      entityId: cobranca?.id ?? charge!.id,
      asaasPaymentId,
      expectedEvents: expectedEventsForPaymentCommand('PAYMENT_UNDO_CASH_COMMAND'),
      correlationId,
      actorId: user.id,
      chargeId: charge?.id ?? null,
      cobrancaId: cobranca?.id ?? null,
      metadata: {
        source: 'POST /api/cobrancas/[id]/undo-receive-in-cash',
        previousAsaasStatus: asaasPayment.status,
      },
    });

    // Executar comando no Asaas
    try {
      await undoCashPayment(asaasPaymentId, { contaId: user.contaId });
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
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      });
    } catch (syncError) {
      console.warn('[Undo Receive In Cash] Falha ao sincronizar estado pós-comando', {
        correlationId,
        commandJobId: command.id,
        asaasPaymentId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    // Registrar auditoria (status final virá via webhook)
    await auditLogService.record({
      contaId: user.contaId,
      action: 'finance.charge.undo_cash_payment_requested',
      entity: { type: cobranca ? 'Cobranca' : 'Charge', id: cobranca?.id ?? charge!.id },
      metadata: {
        correlationId,
        asaasPaymentId,
        previousAsaasStatus: asaasPayment.status,
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
        acao: 'DESFAZER_RECEBIMENTO_DINHEIRO',
        detalhes: {
          cobrancaId: id,
          entityType: cobranca ? 'COBRANCA' : 'CHARGE',
          asaasPaymentId,
          correlationId,
          commandJobId: command.id,
          previousAsaasStatus: asaasPayment.status,
        },
      },
    });

    // Retornar 202 Accepted - status final virá via webhook
    return NextResponse.json(
      cobrancaActionResultDTOSchema.parse(
        mapCobrancaActionResultToDTO({
          success: true,
          message: 'Solicitação enviada. Status será atualizado via webhook.',
          pending: true,
          correlationId,
        }),
      ),
      { status: 202 },
    );
  } catch (e) {
    const error = e as Error;
    console.error('[Undo Receive In Cash] Erro:', error);

    if (error instanceof KycNotApprovedError) {
      return NextResponse.json(
        { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras', correlationId },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: 'Erro ao desfazer recebimento em dinheiro',
        message: error.message,
        correlationId,
      },
      { status: 500 },
    );
  }
}
