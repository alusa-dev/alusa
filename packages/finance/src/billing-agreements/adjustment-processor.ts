import { prisma } from '@alusa/database';

import { createStandaloneCharge } from '../use-cases/create-standalone-charge';
import { refundCobranca, requestBankSlipRefund } from '../use-cases/asaas-ops';
import { createAsaasBillingAgreementPort } from './asaas-subscription.adapter';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';

const LEASE_MS = 5 * 60 * 1000;
const MAX_COMPLEMENT_ATTEMPTS = 5;

export function decideBillingAdjustmentFailure(input: {
  type: string;
  attemptsBeforeClaim: number;
  message: string;
  now: Date;
}): { status: 'PENDING' | 'FAILED' | 'REQUIRES_RECONCILIATION'; availableAt: Date; reconcile: boolean } {
  if (input.message === 'CREDITO_AGUARDANDO_PROXIMA_COBRANCA') {
    return {
      status: 'PENDING',
      availableAt: new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
      reconcile: false,
    };
  }
  const attempt = input.attemptsBeforeClaim + 1;
  if (input.type === 'COMPLEMENT' && attempt < MAX_COMPLEMENT_ATTEMPTS) {
    const backoffMs = Math.min(5 * 60 * 1000 * 2 ** Math.max(attempt - 1, 0), 6 * 60 * 60 * 1000);
    return { status: 'FAILED', availableAt: new Date(input.now.getTime() + backoffMs), reconcile: false };
  }
  return { status: 'REQUIRES_RECONCILIATION', availableAt: input.now, reconcile: true };
}

/** Processa créditos, complementos e reembolsos gerados pelo motor canônico. */
export async function processPendingBillingAdjustments(input?: {
  contaId?: string;
  operationId?: string;
  limit?: number;
  now?: Date;
}) {
  const now = input?.now ?? new Date();
  const adjustments = await prisma.billingAdjustment.findMany({
    where: {
      ...(input?.contaId ? { contaId: input.contaId } : {}),
      ...(input?.operationId ? { operationId: input.operationId } : {}),
      status: { in: ['PENDING', 'FAILED'] },
      availableAt: { lte: now },
      effectiveAt: { lte: now },
      type: { in: ['CREDIT', 'COMPLEMENT', 'REFUND'] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(input?.limit ?? 25, 1), 100),
  });
  const asaas = createAsaasBillingAgreementPort();
  let applied = 0;
  let failed = 0;

  for (const adjustment of adjustments) {
    const claimed = await prisma.billingAdjustment.updateMany({
      where: {
        id: adjustment.id,
        contaId: adjustment.contaId,
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lockedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        lastAttemptAt: now,
      },
    });
    if (claimed.count !== 1) continue;

    try {
      const agreement = await prisma.billingAgreement.findFirst({
        where: { id: adjustment.agreementId, contaId: adjustment.contaId },
        include: { customer: true },
      });
      if (!agreement?.customer) throw new Error('PAGADOR_DO_AJUSTE_NAO_ENCONTRADO');
      const amount = Number(adjustment.amount);
      let providerPaymentId: string | null = null;
      let providerRefundId: string | null = null;
      let bankSlipRefundRequestUrl: string | null = null;

      if (adjustment.type === 'COMPLEMENT') {
        const result = await createStandaloneCharge({
          contaId: adjustment.contaId,
          payer: agreement.payerType === 'RESPONSAVEL'
            ? { type: 'responsavel', responsavelId: agreement.payerId }
            : { type: 'aluno', alunoId: agreement.payerId },
          chargeType: 'ONE_TIME',
          billingType:
            agreement.billingType === 'PIX' || agreement.billingType === 'CREDIT_CARD'
              ? agreement.billingType
              : 'BOLETO',
          value: amount,
          dueDate: adjustment.effectiveAt.toISOString().slice(0, 10),
          description: `Complemento do acordo ${agreement.externalReference}`,
          uiRequestId: adjustment.idempotencyKey,
          actor: { type: 'SYSTEM', id: 'billing-adjustment-worker' },
        });
        if (!result.success || !result.data.asaasPaymentId) {
          throw new Error(`FALHA_COBRANCA_COMPLEMENTAR:${result.success ? 'SEM_PAYMENT_ID' : result.error}`);
        }
        providerPaymentId = result.data.asaasPaymentId;
      } else if (adjustment.type === 'REFUND') {
        if (!adjustment.chargeId) throw new Error('COBRANCA_ORIGEM_DO_REEMBOLSO_AUSENTE');
        const charge = await prisma.charge.findFirst({
          where: { id: adjustment.chargeId, contaId: adjustment.contaId },
          select: { asaasPaymentId: true },
        });
        if (!charge?.asaasPaymentId) throw new Error('PAYMENT_ORIGEM_DO_REEMBOLSO_AUSENTE');
        const payment = await asaas.getPayment({
          contaId: adjustment.contaId,
          paymentId: charge.asaasPaymentId,
        });
        if (payment.billingType === 'BOLETO') {
          if (Math.round(amount * 100) !== payment.valueCents) {
            throw new Error('ESTORNO_PARCIAL_DE_BOLETO_REQUER_REVISAO');
          }
          const request = await requestBankSlipRefund({
            contaId: adjustment.contaId,
            paymentId: charge.asaasPaymentId,
          });
          bankSlipRefundRequestUrl = request.requestUrl;
        } else {
          await refundCobranca({
            contaId: adjustment.contaId,
            paymentId: charge.asaasPaymentId,
            value: amount,
            description: `Ajuste do acordo ${agreement.externalReference}`,
          });
        }
        providerPaymentId = charge.asaasPaymentId;
        // O Asaas confirma o identificador/status final por webhook; guardamos
        // a referência determinística da solicitação para reconciliação.
        providerRefundId = adjustment.externalReference;
      } else {
        if (!agreement.asaasSubscriptionId) throw new Error('ASSINATURA_DO_CREDITO_AUSENTE');
        const payments = await asaas.listSubscriptionPayments({
          contaId: adjustment.contaId,
          subscriptionId: agreement.asaasSubscriptionId,
        });
        const payment = payments
          .filter((item) => item.status === 'PENDING' && item.dueDate >= adjustment.effectiveAt.toISOString().slice(0, 10))
          .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
        if (!payment) throw new Error('CREDITO_AGUARDANDO_PROXIMA_COBRANCA');
        const creditCents = Math.round(amount * 100);
        if (creditCents > payment.valueCents) throw new Error('CREDITO_MAIOR_QUE_PROXIMA_COBRANCA_REQUER_REVISAO');
        if (creditCents === payment.valueCents) {
          await asaas.deletePayment({ contaId: adjustment.contaId, paymentId: payment.id });
        } else {
          await asaas.updatePayment({
            contaId: adjustment.contaId,
            paymentId: payment.id,
            valueCents: payment.valueCents - creditCents,
            billingType:
              payment.billingType === 'PIX' || payment.billingType === 'CREDIT_CARD' || payment.billingType === 'BOLETO'
                ? payment.billingType
                : 'UNDEFINED',
            dueDate: payment.dueDate,
          });
          const confirmed = await asaas.getPayment({ contaId: adjustment.contaId, paymentId: payment.id });
          if (confirmed.valueCents !== payment.valueCents - creditCents || confirmed.status !== 'PENDING') {
            throw new Error('RESULTADO_DO_CREDITO_NAO_CONFIRMADO');
          }
        }
        providerPaymentId = payment.id;
      }

      if (bankSlipRefundRequestUrl) {
        await prisma.billingAdjustment.updateMany({
          where: { id: adjustment.id, contaId: adjustment.contaId, status: 'PROCESSING' },
          data: {
            status: 'REQUIRES_RECONCILIATION',
            providerPaymentId,
            providerRefundId,
            result: {
              providerPaymentId,
              providerRefundId,
              bankSlipRefundRequestUrl,
              customerActionRequired: true,
            },
            lockedAt: null,
            leaseExpiresAt: null,
            lastError: 'AGUARDANDO_DADOS_BANCARIOS_DO_PAGADOR',
          },
        });
        await upsertFinanceReconciliationIssue({
          contaId: adjustment.contaId,
          entityType: 'SUBSCRIPTION',
          entityId: adjustment.agreementId,
          asaasId: providerPaymentId,
          issueType: 'BILLING_OPERATION_UNCERTAIN',
          severity: 'MEDIUM',
          localStatus: 'AGUARDANDO_DADOS_BANCARIOS_DO_PAGADOR',
          remoteStatus: 'REFUND_REQUESTED',
          metadata: {
            adjustmentId: adjustment.id,
            bankSlipRefundRequestUrl,
            customerActionRequired: true,
          },
        });
        failed += 1;
        continue;
      }

      await prisma.billingAdjustment.updateMany({
        where: { id: adjustment.id, contaId: adjustment.contaId, status: 'PROCESSING' },
        data: {
          status: 'APPLIED',
          providerPaymentId,
          providerRefundId,
          result: { providerPaymentId, providerRefundId },
          appliedAt: now,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      applied += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = decideBillingAdjustmentFailure({
        type: adjustment.type,
        attemptsBeforeClaim: adjustment.attempts,
        message,
        now,
      });
      await prisma.billingAdjustment.updateMany({
        where: { id: adjustment.id, contaId: adjustment.contaId, status: 'PROCESSING' },
        data: {
          status: failure.status,
          availableAt: failure.availableAt,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: message.slice(0, 2000),
        },
      });
      if (failure.reconcile) {
        await upsertFinanceReconciliationIssue({
          contaId: adjustment.contaId,
          entityType: 'SUBSCRIPTION',
          entityId: adjustment.agreementId,
          asaasId: adjustment.providerPaymentId,
          issueType: 'BILLING_OPERATION_UNCERTAIN',
          severity: 'HIGH',
          localStatus: 'REQUIRES_RECONCILIATION',
          remoteStatus: null,
          metadata: { adjustmentId: adjustment.id, error: message.slice(0, 1000) },
        });
      }
      failed += 1;
    }
  }
  return { found: adjustments.length, applied, failed };
}
