import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getCustomer as getAsaasCustomer, listCustomers as listAsaasCustomers, listPayments as listAsaasPayments } from '@alusa/asaas';
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
import { hashPayload } from '../core';
import {
  linkReconciledEventRegistrationCharge,
  settleReconciledEventRegistrationCharge,
} from '../events/reconcile-event-registration-charge';
import { assertCompleteAsaasPage } from './asaas-pagination';

const CREATE_TYPES = ['CREATE_PAYMENT', 'CREATE_SUBSCRIPTION', 'CREATE_INSTALLMENT', 'CREATE_CUSTOMER'] as AsaasIntegrationJobType[];
const MAX_RECONCILIATION_PAGES = 100;

async function collectCompletePages<T extends { id: string }>(
  load: (offset: number, limit: number) => Promise<{ data: T[]; hasMore: boolean; totalCount: number; offset: number; limit: number }>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  const seenIds = new Set<string>();
  const seenPages = new Set<string>();
  let expectedTotalCount: number | undefined;
  for (let page = 0; page < MAX_RECONCILIATION_PAGES; page += 1) {
    const response = await load(page * 100, 100);
    if (!response || !Array.isArray(response.data) || typeof response.hasMore !== 'boolean') {
      throw new Error(`${label}_LOOKUP_INCOMPLETE`);
    }
    try {
      expectedTotalCount = assertCompleteAsaasPage(response, page * 100, 100, expectedTotalCount);
    } catch (error) {
      throw new Error(`${label}_LOOKUP_INCOMPLETE:${error instanceof Error ? error.message : 'INVALID_PAGE'}`);
    }
    const pageKey = JSON.stringify(response.data.map((item) => item.id));
    if (seenPages.has(pageKey)) throw new Error(`${label}_LOOKUP_REPEATED_PAGE`);
    seenPages.add(pageKey);
    for (const item of response.data) {
      if (!item?.id || seenIds.has(item.id)) throw new Error(`${label}_LOOKUP_REPEATED_ID`);
      seenIds.add(item.id);
      all.push(item);
    }
    if (!response.hasMore) return all;
    if (response.data.length === 0) throw new Error(`${label}_LOOKUP_INCOMPLETE`);
  }
  throw new Error(`${label}_LOOKUP_PAGE_LIMIT_EXCEEDED`);
}

function normalizeDocument(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

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
          : await collectCompletePages(
            (offset, limit) => listPayments({ externalReference: payload.externalReference, offset, limit, includeDeleted: true }, { contaId: job.contaId }),
            'REMOTE_PAYMENTS',
          ).then((items) => items.filter((item) => item.externalReference === payload.externalReference));
        if (matches.length > 1) throw new Error('MULTIPLE_REMOTE_PAYMENTS_FOR_EXTERNAL_REFERENCE');
        const payment = matches[0];
        if (payment) {
          if (payment.externalReference !== payload.externalReference) throw new Error('REMOTE_PAYMENT_EXTERNAL_REFERENCE_MISMATCH');
          remoteId = payment.id;
          remoteStatus = payment.status;
          const localChargeId = job.chargeId ?? payload.entityId;
          await prisma.charge.updateMany({
            where: { contaId: job.contaId, OR: [{ id: localChargeId }, { externalReference: payload.externalReference }] },
            data: { asaasPaymentId: payment.id, invoiceUrl: payment.invoiceUrl ?? null },
          });
          await linkReconciledEventRegistrationCharge({
            contaId: job.contaId,
            chargeId: localChargeId,
            asaasPaymentId: payment.id,
            asaasInstallmentId: payment.installment,
          });
          const syncResult = await syncPaymentStateFromAsaas({
            contaId: job.contaId,
            asaasPaymentId: payment.id,
            intent: 'RECONCILIATION',
          });
          if (!syncResult.success) throw new Error(`PAYMENT_STATE_SYNC_FAILED:${syncResult.error}`);
          remoteStatus = syncResult.paymentStatus;
          await settleReconciledEventRegistrationCharge({
            contaId: job.contaId,
            chargeId: localChargeId,
            paymentStatus: syncResult.paymentStatus,
          });
        }
      } else if (payload.resource === 'SUBSCRIPTION') {
        const matches = remoteId
          ? [await getSubscription(remoteId, { contaId: job.contaId })]
          : await collectCompletePages(
            (offset, limit) => listSubscriptions({ externalReference: payload.externalReference, offset, limit, includeDeleted: true }, { contaId: job.contaId }),
            'REMOTE_SUBSCRIPTIONS',
          ).then((items) => items.filter((item) => item.externalReference === payload.externalReference));
        if (matches.length > 1) throw new Error('MULTIPLE_REMOTE_SUBSCRIPTIONS_FOR_EXTERNAL_REFERENCE');
        const subscription = matches[0];
        if (subscription) {
          if (subscription.externalReference !== payload.externalReference) throw new Error('REMOTE_SUBSCRIPTION_EXTERNAL_REFERENCE_MISMATCH');
          remoteId = subscription.id;
          remoteStatus = subscription.status;
          const status = mapAsaasSubscriptionStatus({ status: subscription.status, deleted: subscription.deleted });
          await prisma.$transaction([
            prisma.subscription.updateMany({ where: { contaId: job.contaId, externalReference: payload.externalReference }, data: { asaasSubscriptionId: subscription.id, status, statusUpdatedAt: new Date() } }),
            prisma.standaloneSubscription.updateMany({ where: { contaId: job.contaId, externalReference: payload.externalReference }, data: { asaasSubscriptionId: subscription.id, status, statusUpdatedAt: new Date() } }),
          ]);
        }
      } else if (payload.resource === 'CUSTOMER') {
        const expectedDocumentFingerprint = typeof payload.metadata?.cpfCnpjFingerprint === 'string'
          ? payload.metadata.cpfCnpjFingerprint
          : null;
        if (!expectedDocumentFingerprint || !/^[a-f0-9]{64}$/i.test(expectedDocumentFingerprint)) {
          throw new Error('CUSTOMER_DOCUMENT_FINGERPRINT_MISSING_OR_INVALID');
        }
        const creds = await loadAsaasCredentials(job.contaId);
        if (!creds) throw new Error('ASAAS_CREDENTIALS_NOT_CONFIGURED');
        const customers = remoteId
          ? [await getAsaasCustomer({ apiKey: creds.apiKey, customerId: remoteId })]
          : await collectCompletePages(
            (offset, limit) => listAsaasCustomers({ apiKey: creds.apiKey, externalReference: payload.externalReference, offset, limit }),
            'REMOTE_CUSTOMERS',
          ).then((items) => items.filter((item) => item.externalReference === payload.externalReference));
        if (customers.length > 1) throw new Error('MULTIPLE_REMOTE_CUSTOMERS_FOR_EXTERNAL_REFERENCE');
        const customer = customers[0];
        if (customer) {
          if (!customer.id || customer.externalReference !== payload.externalReference) {
            throw new Error('REMOTE_CUSTOMER_EXTERNAL_REFERENCE_MISMATCH');
          }
          if (hashPayload(normalizeDocument(customer.cpfCnpj)) !== expectedDocumentFingerprint) {
            throw new Error('REMOTE_CUSTOMER_DOCUMENT_MISMATCH');
          }
          remoteId = customer.id;
          remoteStatus = 'FOUND';
        }
      } else {
        const creds = await loadAsaasCredentials(job.contaId);
        if (!creds) throw new Error('ASAAS_CREDENTIALS_NOT_CONFIGURED');
        if (!remoteId) {
          const payments = await collectCompletePages(
            (offset, limit) => listAsaasPayments({ apiKey: creds.apiKey, externalReference: payload.externalReference, offset, limit, includeDeleted: true }),
            'REMOTE_INSTALLMENT_PAYMENTS',
          ).then((items) => items.filter((item) => item.externalReference === payload.externalReference));
          if (payments.some((payment) => !payment.installment)) throw new Error('REMOTE_INSTALLMENT_PAYMENT_WITHOUT_INSTALLMENT_ID');
          const ids = [...new Set(payments.map((payment) => payment.installment).filter((id): id is string => Boolean(id)))];
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
