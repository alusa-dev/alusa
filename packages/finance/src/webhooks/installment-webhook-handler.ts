import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getInstallment, listInstallmentPayments } from '@alusa/asaas';
import type { InstallmentStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { logFinanceOperationalEvent } from '../foundation/operational-log';
import { parseExternalReference } from '../core';
import { publishFinanceEvent } from '../realtime/finance-realtime-publisher';
import { normalizeAsaasPaymentSnapshotStatus } from '../mappers/asaas-payment-snapshot-status';

export type InstallmentWebhookPayload = {
  event: string;
  payment: {
    id: string;
    status?: string;
    billingType?: string | null;
    externalReference?: string;
    installment?: string | null;
    installmentNumber?: number | null;
    deleted?: boolean | null;
  };
};

const PAID_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);

/**
 * Extrai o InstallmentPlan ID do externalReference
 * Suporta V1 (installmentPlan:{id}) e V2 (alusa:installment:{id}:{subcontaId})
 */
function tryParseInstallmentPlanId(externalReference: string | undefined): string | null {
  if (!externalReference) return null;
  
  // Tentar V2 primeiro
  const parsed = parseExternalReference(externalReference);
  if (parsed && parsed.type === 'installment' && parsed.ids.installmentPlanId) {
    return parsed.ids.installmentPlanId;
  }
  
  // Fallback V1
  if (externalReference.startsWith('installmentPlan:')) {
    const rest = externalReference.slice('installmentPlan:'.length);
    // Pode ser installmentPlan:{id} ou installmentPlan:pending:{id}
    if (rest.startsWith('pending:')) {
      return rest.slice('pending:'.length).split(':')[0] || null;
    }
    return rest.split(':')[0] || null;
  }
  
  return null;
}

function shouldHandleEvent(event: string): boolean {
  // eventos de pagamento são a fonte de verdade e podem alterar o estado do carnê
  return event.startsWith('PAYMENT_');
}

async function computeStatusViaAsaas(params: {
  contaId: string;
  asaasInstallmentId: string;
  installmentCount: number;
}): Promise<{ status: InstallmentStatus | null; method: 'asaas'; details: Record<string, unknown> } | null> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials?.apiKey) return { status: null, method: 'asaas', details: { lookupComplete: false } };

  const installment = await getInstallment({
    apiKey: credentials.apiKey,
    installmentId: params.asaasInstallmentId,
  }).catch((error) => {
    logFinanceOperationalEvent({
      severity: 'error',
      eventName: 'finance.webhook.installment.asaas_lookup.failed',
      error,
    });
    return null;
  });

  if (!installment) return { status: null, method: 'asaas', details: { lookupComplete: false } };

  if (installment.deleted) {
    return {
      status: 'CANCELED',
      method: 'asaas',
      details: { installmentDeleted: true },
    };
  }

  const payments: Array<{ id: string; status: string; deleted?: boolean }> = [];
  const seenIds = new Set<string>();
  const pageSize = 100;
  let offset = 0;
  let expectedTotalCount: number | undefined;

  while (true) {
    const page = await listInstallmentPayments({
      apiKey: credentials.apiKey,
      installmentId: params.asaasInstallmentId,
      limit: pageSize,
      offset,
    }).catch((error) => {
      logFinanceOperationalEvent({
        severity: 'error',
        eventName: 'finance.webhook.installment.payments_lookup.failed',
        error,
      });
      return null;
    });

    if (
      !page ||
      typeof page.hasMore !== 'boolean' ||
      !Array.isArray(page.data) ||
      !Number.isInteger(page.limit) ||
      page.limit <= 0 ||
      page.limit > pageSize ||
      page.offset !== offset ||
      page.data.length > page.limit ||
      !Number.isInteger(page.totalCount) ||
      page.totalCount < 0 ||
      (expectedTotalCount !== undefined && page.totalCount !== expectedTotalCount)
    ) {
      logFinanceOperationalEvent({
        severity: 'error',
        eventName: 'finance.webhook.installment.payments_lookup.failed',
        error: new Error('ASAAS_INSTALLMENT_PAYMENT_PAGE_INVALID_OR_INCONSISTENT'),
      });
      return { status: null, method: 'asaas', details: { lookupComplete: false } };
    }
    expectedTotalCount ??= page.totalCount;

    for (const item of page.data) {
      if (!item.id?.trim() || seenIds.has(item.id)) {
        logFinanceOperationalEvent({
          severity: 'error',
          eventName: 'finance.webhook.installment.payments_lookup.failed',
          error: new Error('ASAAS_INSTALLMENT_PAYMENT_ID_DUPLICATE_OR_INVALID'),
        });
        return { status: null, method: 'asaas', details: { lookupComplete: false } };
      }
      seenIds.add(item.id);
      const status =
        normalizeAsaasPaymentSnapshotStatus({
          status: item.status,
          billingType: (item as { billingType?: string | null }).billingType,
          deleted: item.deleted,
        }) ?? item.status;
      payments.push({ id: item.id, status, deleted: item.deleted });
    }

    if (page.hasMore) {
      if (page.data.length === 0 || payments.length >= expectedTotalCount) {
        logFinanceOperationalEvent({
          severity: 'error',
          eventName: 'finance.webhook.installment.payments_lookup.failed',
          error: new Error('ASAAS_INSTALLMENT_PAYMENT_PAGINATION_DID_NOT_PROGRESS'),
        });
        return { status: null, method: 'asaas', details: { lookupComplete: false } };
      }
    } else {
      if (payments.length !== expectedTotalCount) {
        logFinanceOperationalEvent({
          severity: 'error',
          eventName: 'finance.webhook.installment.payments_lookup.failed',
          error: new Error('ASAAS_INSTALLMENT_PAYMENT_TOTAL_COUNT_MISMATCH'),
        });
        return { status: null, method: 'asaas', details: { lookupComplete: false } };
      }
      break;
    }

    offset = page.offset + page.data.length;

    // fail-safe: evitar loop infinito caso a API retorne dados inconsistentes
    if (offset > 10_000) {
      return { status: null, method: 'asaas', details: { lookupComplete: false } };
    }
  }

  const activePayments = payments.filter((p) => !p.deleted);
  const paidActivePayments = activePayments.filter((p) => PAID_PAYMENT_STATUSES.has(p.status));
  const isCompleted = activePayments.length >= params.installmentCount && paidActivePayments.length === activePayments.length;

  return {
    status: isCompleted ? 'COMPLETED' : 'ACTIVE',
    method: 'asaas',
    details: {
      activePaymentsCount: activePayments.length,
      paidActivePaymentsCount: paidActivePayments.length,
    },
  };
}

function computeStatusHeuristically(params: {
  currentStatus: InstallmentStatus;
  event: string;
  paymentStatus: string | undefined;
  installmentNumber: number | null;
  installmentCount: number;
}): { status: InstallmentStatus; method: 'heuristic'; details: Record<string, unknown> } | null {
  const isPaidEvent = params.event === 'PAYMENT_CONFIRMED' || params.event === 'PAYMENT_RECEIVED';
  const isPaidStatus = params.paymentStatus ? PAID_PAYMENT_STATUSES.has(params.paymentStatus) : false;

  if (
    isPaidEvent &&
    isPaidStatus &&
    typeof params.installmentNumber === 'number' &&
    params.installmentNumber >= params.installmentCount
  ) {
    return {
      status: 'COMPLETED',
      method: 'heuristic',
      details: { reason: 'last_installment_paid' },
    };
  }

  const canReopen =
    params.currentStatus === 'COMPLETED' &&
    (params.event === 'PAYMENT_REFUNDED' || params.event === 'PAYMENT_DELETED' || params.event === 'PAYMENT_PARTIALLY_REFUNDED');

  if (canReopen) {
    return {
      status: 'ACTIVE',
      method: 'heuristic',
      details: { reason: 'payment_reverted_after_completion' },
    };
  }

  return null;
}

export async function handleInstallmentWebhook(
  contaId: string,
  payload: InstallmentWebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!shouldHandleEvent(payload.event)) return { success: true };

    const externalReference = payload.payment.externalReference;
    const installmentPlanIdFromExternalRef = tryParseInstallmentPlanId(externalReference);
    const asaasInstallmentIdFromPayload = payload.payment.installment ?? null;

    const installmentPlan = await prisma.installmentPlan.findFirst({
      where: {
        contaId,
        OR: [
          ...(asaasInstallmentIdFromPayload ? [{ asaasInstallmentId: asaasInstallmentIdFromPayload }] : []),
          ...(externalReference ? [{ externalReference }] : []),
          ...(installmentPlanIdFromExternalRef ? [{ id: installmentPlanIdFromExternalRef }] : []),
        ],
      },
      select: {
        id: true,
        status: true,
        statusUpdatedAt: true,
        asaasInstallmentId: true,
        externalReference: true,
        installmentCount: true,
      },
    });

    if (!installmentPlan) {
      return { success: true };
    }

    const asaasInstallmentId = asaasInstallmentIdFromPayload ?? installmentPlan.asaasInstallmentId;

    const updates: {
      asaasInstallmentId?: string;
      status?: InstallmentStatus;
      statusUpdatedAt?: Date;
    } = {};

    if (!installmentPlan.asaasInstallmentId && asaasInstallmentIdFromPayload) {
      updates.asaasInstallmentId = asaasInstallmentIdFromPayload;
    }

    const asaasComputed = asaasInstallmentId
      ? await computeStatusViaAsaas({
          contaId,
          asaasInstallmentId,
          installmentCount: installmentPlan.installmentCount,
        })
      : null;

    let computed: {
      status: InstallmentStatus;
      method: 'asaas' | 'heuristic';
      details: Record<string, unknown>;
    } | null = null;

    if (asaasComputed) {
      const asaasStatus = asaasComputed.status;
      if (asaasStatus === null) {
        return { success: false, error: 'ASAAS_INSTALLMENT_STATUS_LOOKUP_FAILED' };
      }
      computed = { status: asaasStatus, method: asaasComputed.method, details: asaasComputed.details };
    } else {
      computed = computeStatusHeuristically({
        currentStatus: installmentPlan.status,
        event: payload.event,
        paymentStatus:
          normalizeAsaasPaymentSnapshotStatus({
            eventName: payload.event,
            status: payload.payment.status,
            billingType: payload.payment.billingType,
            deleted: payload.payment.deleted,
          }) ?? payload.payment.status,
        installmentNumber: payload.payment.installmentNumber ?? null,
        installmentCount: installmentPlan.installmentCount,
      });
    }

    if (computed && computed.status !== installmentPlan.status) {
      updates.status = computed.status;
      updates.statusUpdatedAt = new Date();
    }

    if (Object.keys(updates).length === 0) {
      return { success: true };
    }

    await prisma.installmentPlan.update({ where: { id: installmentPlan.id }, data: updates });

    if (updates.status && updates.status !== installmentPlan.status) {
      await auditLogService.record({
        contaId,
        action: 'finance.webhook.installmentPlan_status_changed',
        entity: { type: 'InstallmentPlan', id: installmentPlan.id },
        metadata: {
          event: payload.event,
          asaasPaymentId: payload.payment.id,
          asaasInstallmentId: asaasInstallmentId ?? null,
          externalReference: installmentPlan.externalReference,
          asaasPaymentStatus: payload.payment.status ?? null,
          installmentNumber: payload.payment.installmentNumber ?? null,
          previousStatus: installmentPlan.status,
          nextStatus: updates.status,
          resolutionMethod: computed?.method ?? null,
          resolutionDetails: computed?.details ?? null,
        },
      });
    }

    try {
      await publishFinanceEvent({
        contaId,
        type: 'installment.updated',
        entityId: installmentPlan.id,
        asaasPaymentId: payload.payment.id,
        revision: Date.now(),
      });
    } catch (publishError) {
      logFinanceOperationalEvent({
        severity: 'warn',
        eventName: 'finance.webhook.installment.realtime_publish.failed',
        error: publishError,
      });
    }

    return { success: true };
  } catch (error) {
    logFinanceOperationalEvent({ severity: 'error', eventName: 'finance.webhook.installment.processing.failed', error });
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
