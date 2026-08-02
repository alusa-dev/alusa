import { prisma, loadAsaasCredentials } from '@alusa/database';
import { listPayments as listAsaasPayments } from '@alusa/asaas';
import type { AsaasIntegrationJobType } from '@prisma/client';

import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import {
  buildFinanceReconciliationIssueDedupeKey,
  resolveFinanceReconciliationIssueByDedupe,
} from '../reconciliation/finance-reconciliation-issue.service';
import { getInstallment, getPayment, getSubscription, listPayments, listSubscriptions } from './asaas-ops';
import {
  markOutboundRemoteConfirmed,
  markOutboundRequiresReconciliation,
  markOutboundSynchronized,
  parseOutboundFinancialOperation,
} from './outbound-financial-operation';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';

const CREATE_TYPES = ['CREATE_PAYMENT', 'CREATE_SUBSCRIPTION', 'CREATE_INSTALLMENT'] as AsaasIntegrationJobType[];

export async function reconcileOutboundFinancialOperations(input: {
  contaId?: string;
  limit?: number;
  olderThanSeconds?: number;
} = {}) {
  const threshold = new Date(Date.now() - Math.max(5, input.olderThanSeconds ?? 30) * 1000);
  const jobs = await prisma.asaasIntegrationJob.findMany({
    where: {
      ...(input.contaId ? { contaId: input.contaId } : {}),
      type: { in: CREATE_TYPES },
      status: { in: ['PENDING', 'PROCESSING'] },
      nextAttemptAt: { lte: new Date() },
      createdAt: { lt: threshold },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(200, Math.max(1, input.limit ?? 50)),
  });
  let recovered = 0;
  let missing = 0;
  let divergent = 0;

  for (const job of jobs) {
    const payload = parseOutboundFinancialOperation(job.payload);
    if (!payload) continue;
    try {
      let remoteId = payload.remoteId ?? null;
      let remoteStatus: string | null = null;

      if (payload.resource === 'PAYMENT') {
        const matches = remoteId
          ? [await getPayment(remoteId, { contaId: job.contaId })]
          : await listPayments({ externalReference: payload.externalReference, limit: 10, includeDeleted: true }, { contaId: job.contaId }).then((r) => r.data);
        if (matches.length > 1) throw new Error('MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE');
        const payment = matches[0];
        if (payment) {
          remoteId = payment.id;
          remoteStatus = payment.status;
          await prisma.charge.updateMany({
            where: { contaId: job.contaId, OR: [{ id: job.chargeId ?? payload.entityId }, { externalReference: payload.externalReference }] },
            data: { asaasPaymentId: payment.id, invoiceUrl: payment.invoiceUrl ?? null },
          });
          await syncPaymentStateFromAsaas({ contaId: job.contaId, asaasPaymentId: payment.id, intent: 'RECONCILIATION' });
        }
      } else if (payload.resource === 'SUBSCRIPTION') {
        const matches = remoteId
          ? [await getSubscription(remoteId, { contaId: job.contaId }).catch(() => null)].filter(Boolean)
          : await listSubscriptions({ externalReference: payload.externalReference, limit: 10, includeDeleted: true }, { contaId: job.contaId }).then((r) => r.data);
        if (matches.length > 1) throw new Error('MULTIPLE_REMOTE_SUBSCRIPTIONS_FOR_EXTERNAL_REFERENCE');
        const subscription = matches[0];
        if (subscription) {
          remoteId = subscription.id;
          remoteStatus = subscription.status;
          const status = mapAsaasSubscriptionStatus({ status: subscription.status, deleted: subscription.deleted });
          await prisma.$transaction([
            prisma.subscription.updateMany({ where: { contaId: job.contaId, externalReference: payload.externalReference }, data: { asaasSubscriptionId: subscription.id, status, statusUpdatedAt: new Date() } }),
            prisma.standaloneSubscription.updateMany({ where: { contaId: job.contaId, externalReference: payload.externalReference }, data: { asaasSubscriptionId: subscription.id, status, statusUpdatedAt: new Date() } }),
          ]);
        }
      } else {
        const creds = await loadAsaasCredentials(job.contaId);
        if (!creds) throw new Error('ASAAS_CREDENTIALS_NOT_CONFIGURED');
        if (!remoteId) {
          const payments = await listAsaasPayments({ apiKey: creds.apiKey, externalReference: payload.externalReference, limit: 100, includeDeleted: true });
          const ids = [...new Set(payments.data.map((payment) => payment.installment).filter((id): id is string => Boolean(id)))];
          if (ids.length > 1) throw new Error('MULTIPLE_REMOTE_INSTALLMENTS_FOR_EXTERNAL_REFERENCE');
          remoteId = ids[0] ?? null;
        }
        if (remoteId) {
          const installment = await getInstallment(remoteId, { contaId: job.contaId });
          remoteStatus = installment.id ? 'FOUND' : null;
          await prisma.$transaction([
            prisma.installmentPlan.updateMany({ where: { contaId: job.contaId, externalReference: payload.externalReference }, data: { asaasInstallmentId: remoteId } }),
            prisma.standaloneInstallmentPlan.updateMany({ where: { contaId: job.contaId, externalReference: payload.externalReference }, data: { asaasInstallmentId: remoteId } }),
          ]);
        }
      }

      if (!remoteId) {
        missing += 1;
        const attempts = job.attempts + 1;
        if (attempts >= 5) {
          await markOutboundRequiresReconciliation({
            jobId: job.id,
            contaId: job.contaId,
            resource: payload.resource,
            entityId: payload.entityId,
            externalReference: payload.externalReference,
            error: 'REMOTE_RESOURCE_NOT_FOUND_DURING_RECONCILIATION',
          });
        } else {
          await prisma.asaasIntegrationJob.update({
            where: { id: job.id },
            data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(15 * 60_000, 2 ** attempts * 10_000)) },
          });
        }
        continue;
      }

      await markOutboundRemoteConfirmed(job.id, remoteId, { reconciledRemoteStatus: remoteStatus });
      await markOutboundSynchronized(job.id, remoteId, { synchronizedBy: 'active-reconciliation' });
      const dedupeKey = buildFinanceReconciliationIssueDedupeKey({
        entityType: payload.resource,
        entityId: payload.entityId,
        asaasId: remoteId,
        issueType: 'BILLING_OPERATION_UNCERTAIN',
      });
      await resolveFinanceReconciliationIssueByDedupe({
        contaId: job.contaId,
        dedupeKey,
        resolution: 'Recurso confirmado pela reconciliação ativa com o Asaas.',
      });
      recovered += 1;
    } catch (error) {
      divergent += 1;
      await markOutboundRequiresReconciliation({
        jobId: job.id,
        contaId: job.contaId,
        resource: payload.resource,
        entityId: payload.entityId,
        externalReference: payload.externalReference,
        error,
      });
    }
  }

  return { scanned: jobs.length, recovered, missing, divergent };
}
