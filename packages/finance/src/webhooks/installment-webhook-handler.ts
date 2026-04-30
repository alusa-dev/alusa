import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getInstallment, listInstallmentPayments } from '@alusa/asaas';
import type { InstallmentStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { parseExternalReference } from '../core';

export type InstallmentWebhookPayload = {
  event: string;
  payment: {
    id: string;
    status?: string;
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
}): Promise<{ status: InstallmentStatus; method: 'asaas'; details: Record<string, unknown> } | null> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials?.apiKey) return null;

  const installment = await getInstallment({
    apiKey: credentials.apiKey,
    installmentId: params.asaasInstallmentId,
  }).catch((error) => {
    console.error('[finance][handleInstallmentWebhook][getInstallment]', error);
    return null;
  });

  if (!installment) return null;

  if (installment.deleted) {
    return {
      status: 'CANCELED',
      method: 'asaas',
      details: { installmentDeleted: true },
    };
  }

  const payments: Array<{ id: string; status: string; deleted?: boolean }> = [];
  let offset = 0;

  while (true) {
    const page = await listInstallmentPayments({
      apiKey: credentials.apiKey,
      installmentId: params.asaasInstallmentId,
      limit: 100,
      offset,
    }).catch((error) => {
      console.error('[finance][handleInstallmentWebhook][listInstallmentPayments]', error);
      return null;
    });

    if (!page) return null;

    for (const item of page.data) {
      payments.push({ id: item.id, status: item.status, deleted: item.deleted });
    }

    if (!page.hasMore) break;
    offset += page.limit;

    // fail-safe: evitar loop infinito caso a API retorne dados inconsistentes
    if (offset > 10_000) return null;
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

    const computed =
      asaasComputed ??
      computeStatusHeuristically({
        currentStatus: installmentPlan.status,
        event: payload.event,
        paymentStatus: payload.payment.status,
        installmentNumber: payload.payment.installmentNumber ?? null,
        installmentCount: installmentPlan.installmentCount,
      });

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

    return { success: true };
  } catch (error) {
    console.error('[finance][handleInstallmentWebhook]', error);
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
