import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  KycNotApprovedError,
  undoCashPayment,
  isAsaasEnabled,
  normalizeAsaasPaymentSnapshotStatus,
  readPaymentFullPreflight,
  auditLogService,
  syncPaymentStateFromAsaas,
  evaluatePaymentActionPolicy,
  runAsaasPaymentCommand,
} from '@alusa/finance';
import { randomUUID } from 'crypto';
import {
  cobrancaActionResultDTOSchema,
  cobrancaRouteParamsDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaActionResultToDTO } from '@/features/financeiro/cobrancas/mappers';
import { resolveCobrancaPaymentLookup } from '@/src/server/finance/resolve-cobranca-payment-lookup';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const CASH_UNDO_ALREADY_APPLIED_STATUSES = new Set(['PENDING', 'OVERDUE']);

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

function getEffectiveAsaasStatus(payment: {
  status?: string | null;
  billingType?: string | null;
  deleted?: boolean | null;
}) {
  return (
    normalizeAsaasPaymentSnapshotStatus({
      status: payment.status,
      billingType: payment.billingType,
      deleted: payment.deleted,
    }) ??
    payment.status ??
    'PENDING'
  );
}

async function syncAlreadyUndoneCashPayment(params: {
  contaId: string;
  asaasPaymentId: string;
  correlationId: string;
  source: string;
}) {
  try {
    await syncPaymentStateFromAsaas({
      contaId: params.contaId,
      asaasPaymentId: params.asaasPaymentId,
      eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    });
  } catch (syncError) {
    console.warn('[Undo Receive In Cash] Falha ao reconciliar recebimento já desfeito', {
      correlationId: params.correlationId,
      asaasPaymentId: params.asaasPaymentId,
      source: params.source,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
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
    const userId = user.id;
    const contaId = user.contaId;

    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(await params);

    const cobranca = await prisma.cobranca.findFirst({
      where: { id, matricula: { aluno: { contaId } } },
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
          where: { id, contaId },
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
      const paymentLookup = await resolveCobrancaPaymentLookup(prisma, contaId, id);
      if (!paymentLookup) {
        return NextResponse.json(
          { error: 'Cobrança não encontrada', correlationId },
          { status: 404 },
        );
      }

      const asaasPaymentId = paymentLookup.asaasPaymentId;
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

      const asaasPayment = await readPaymentFullPreflight(asaasPaymentId, { contaId });
      const effectiveAsaasStatus = getEffectiveAsaasStatus(asaasPayment);
      if (CASH_UNDO_ALREADY_APPLIED_STATUSES.has(effectiveAsaasStatus)) {
        await syncAlreadyUndoneCashPayment({
          contaId,
          asaasPaymentId,
          correlationId,
          source: 'lookup',
        });

        return NextResponse.json(
          cobrancaActionResultDTOSchema.parse(
            mapCobrancaActionResultToDTO({
              success: true,
              message: 'Recebimento em dinheiro já estava desfeito no Asaas. Estado local reconciliado.',
              pending: false,
              correlationId,
            }),
          ),
          { status: 200 },
        );
      }

      const policy = evaluatePaymentActionPolicy({
        entityType: 'COBRANCA',
        origin: 'EVENT',
        localStatus: paymentLookup.localStatus,
        asaasStatus: effectiveAsaasStatus,
        billingType: asaasPayment.billingType ?? paymentLookup.billingType,
        hasAsaasPaymentId: true,
        hasInvoiceUrl: Boolean(paymentLookup.invoiceUrl),
        wasReceivedInCash: effectiveAsaasStatus === 'RECEIVED_IN_CASH',
      });

      if (!policy.canUndoCashPayment) {
        const decision = policy.actions.UNDO_CASH_PAYMENT;
        return NextResponse.json(
          {
            error: decision.reason ?? `Operação não permitida. Status atual no Asaas: ${asaasPayment.status}`,
            correlationId,
            asaasStatus: effectiveAsaasStatus,
            code: decision.code,
            ...(decision.hint ? { hint: decision.hint } : {}),
          },
          { status: 400 },
        );
      }

      const { commandJobId } = await runAsaasPaymentCommand({
        contaId,
        type: 'PAYMENT_UNDO_CASH_COMMAND',
        entityType: 'CHARGE',
        entityId: id,
        asaasPaymentId,
        correlationId,
        actorId: userId,
        metadata: {
          source: 'POST /api/cobrancas/[id]/undo-receive-in-cash',
          origin: 'EVENT',
          previousAsaasStatus: asaasPayment.status,
          previousEffectiveAsaasStatus: effectiveAsaasStatus,
        },
        providerStatus: effectiveAsaasStatus,
        run: () => undoCashPayment(asaasPaymentId, { contaId }),
      });

      try {
        await syncPaymentStateFromAsaas({
          contaId,
          asaasPaymentId,
          eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        });
      } catch (syncError) {
        console.warn('[UndoCash] Falha ao sincronizar estado pós-comando (event)', {
          correlationId,
          commandJobId,
          asaasPaymentId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }

      await auditLogService.record({
        contaId,
        action: 'finance.charge.undo_cash_requested',
        entity: { type: 'Charge', id },
        metadata: {
          correlationId,
          asaasPaymentId,
          origin: 'EVENT',
          previousAsaasStatus: asaasPayment.status,
          previousEffectiveAsaasStatus: effectiveAsaasStatus,
          requestedBy: userId,
          durationMs: Date.now() - startedAt,
        },
      });

      return NextResponse.json(
        cobrancaActionResultDTOSchema.parse(
          mapCobrancaActionResultToDTO({
            success: true,
            message: 'Desfazer recebimento solicitado. Status será atualizado via webhook.',
            pending: true,
            correlationId,
          }),
        ),
        { status: 202 },
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
    const asaasPayment = await readPaymentFullPreflight(asaasPaymentId, { contaId });
    const effectiveAsaasStatus = getEffectiveAsaasStatus(asaasPayment);
    if (CASH_UNDO_ALREADY_APPLIED_STATUSES.has(effectiveAsaasStatus)) {
      await syncAlreadyUndoneCashPayment({
        contaId,
        asaasPaymentId,
        correlationId,
        source: cobranca ? 'cobranca' : 'charge',
      });

      await auditLogService.record({
        contaId,
        action: 'finance.charge.undo_cash_payment_already_applied',
        entity: { type: cobranca ? 'Cobranca' : 'Charge', id: cobranca?.id ?? charge!.id },
        metadata: {
          correlationId,
          asaasPaymentId,
          currentAsaasStatus: asaasPayment.status,
          currentEffectiveAsaasStatus: effectiveAsaasStatus,
          requestedBy: userId,
          requestedByRole: user.role,
          durationMs: Date.now() - startedAt,
        },
      });

      return NextResponse.json(
        cobrancaActionResultDTOSchema.parse(
          mapCobrancaActionResultToDTO({
            success: true,
            message: 'Recebimento em dinheiro já estava desfeito no Asaas. Estado local reconciliado.',
            pending: false,
            correlationId,
          }),
        ),
        { status: 200 },
      );
    }

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
      asaasStatus: effectiveAsaasStatus,
      billingType: asaasPayment.billingType ?? charge?.billingType ?? null,
      hasAsaasPaymentId: true,
      hasInvoiceUrl: Boolean(cobranca?.charge?.invoiceUrl || charge?.invoiceUrl),
      wasReceivedInCash: effectiveAsaasStatus === 'RECEIVED_IN_CASH',
      isInstallmentPayment: cobranca?.tipo === 'PARCELADA' || Boolean(charge?.standaloneInstallmentPlanId),
      isSubscriptionPayment: cobranca?.tipo === 'RECORRENTE' || Boolean(charge?.standaloneSubscriptionId),
    });

    if (!policy.canUndoCashPayment) {
      const decision = policy.actions.UNDO_CASH_PAYMENT;
      return NextResponse.json(
        {
          error: decision.reason ?? `Operação não permitida. Status atual no Asaas: ${asaasPayment.status}`,
          correlationId,
          asaasStatus: effectiveAsaasStatus,
          code: decision.code,
          ...(decision.hint ? { hint: decision.hint } : {}),
        },
        { status: 400 },
      );
    }

    const { commandJobId } = await runAsaasPaymentCommand({
      contaId,
      type: 'PAYMENT_UNDO_CASH_COMMAND',
      entityType: cobranca ? 'COBRANCA' : 'CHARGE',
      entityId: cobranca?.id ?? charge!.id,
      asaasPaymentId,
      correlationId,
      actorId: userId,
      chargeId: charge?.id ?? null,
      cobrancaId: cobranca?.id ?? null,
      metadata: {
        source: 'POST /api/cobrancas/[id]/undo-receive-in-cash',
        previousAsaasStatus: asaasPayment.status,
        previousEffectiveAsaasStatus: effectiveAsaasStatus,
      },
      providerStatus: effectiveAsaasStatus,
      run: () => undoCashPayment(asaasPaymentId, { contaId }),
    });

    try {
      await syncPaymentStateFromAsaas({
        contaId,
        asaasPaymentId,
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      });
    } catch (syncError) {
      console.warn('[Undo Receive In Cash] Falha ao sincronizar estado pós-comando', {
        correlationId,
        commandJobId,
        asaasPaymentId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    // Registrar auditoria (status final virá via webhook)
    await auditLogService.record({
      contaId,
      action: 'finance.charge.undo_cash_payment_requested',
      entity: { type: cobranca ? 'Cobranca' : 'Charge', id: cobranca?.id ?? charge!.id },
      metadata: {
        correlationId,
        asaasPaymentId,
        previousAsaasStatus: asaasPayment.status,
        previousEffectiveAsaasStatus: effectiveAsaasStatus,
        requestedBy: userId,
        requestedByRole: user.role,
        durationMs: Date.now() - startedAt,
      },
    });

    // Registrar log financeiro
    await prisma.logFinanceiro.create({
      data: {
        contaId,
        usuarioId: userId,
        cobrancaId: cobranca?.id ?? null,
        acao: 'DESFAZER_RECEBIMENTO_DINHEIRO',
        detalhes: {
          cobrancaId: id,
          entityType: cobranca ? 'COBRANCA' : 'CHARGE',
          asaasPaymentId,
          correlationId,
          commandJobId,
          previousAsaasStatus: asaasPayment.status,
          previousEffectiveAsaasStatus: effectiveAsaasStatus,
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
