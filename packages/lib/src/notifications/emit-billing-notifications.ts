import { logLibOperationalEvent } from '../observability/operational-log';
import {
  createBillingWebhookNotification,
  isBillingNotificationEvent,
} from '../services/notifications.service';

export type BillingNotificationCandidate = {
  contaId: string;
  event: string;
  eventId?: string | null;
  asaasPaymentId: string;
  occurredAt?: string | Date | null;
};

function normalizeOccurredAt(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const iso = `${trimmed.replace(' ', 'T')}-03:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function selectFirstBillingNotificationOccurredAt(
  candidates: Array<string | Date | null | undefined>,
): Date | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeOccurredAt(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}

export async function emitBillingNotificationCandidate(
  candidate: BillingNotificationCandidate,
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC',
) {
  if (!isBillingNotificationEvent(candidate.event)) {
    return { emitted: false };
  }

  const result = await createBillingWebhookNotification({
    contaId: candidate.contaId,
    eventId: candidate.eventId ?? null,
    eventName: candidate.event,
    asaasPaymentId: candidate.asaasPaymentId,
    occurredAt: selectFirstBillingNotificationOccurredAt([candidate.occurredAt]),
    sourceType,
  });

  if (result.outcome === 'inconsistent') {
    throw new Error(`Origem financeira inconsistente: ${result.reason ?? 'notification_result_unclassified'}`);
  }

  return { emitted: true };
}

export async function emitBillingNotifications(
  candidates: BillingNotificationCandidate[],
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC',
  options?: { throwOnError?: boolean },
) {
  await Promise.all(
    candidates.map((candidate) =>
      emitBillingNotificationCandidate(candidate, sourceType).catch((error) => {
        if (options?.throwOnError) throw error;

        logLibOperationalEvent({
          eventName: 'notification.billing.create.failed',
          error,
        });
      }),
    ),
  );
}
