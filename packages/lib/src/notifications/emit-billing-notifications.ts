import {
  createBillingWebhookNotification,
  isBillingNotificationEvent,
} from '../services/notifications.service';

export type BillingNotificationCandidate = {
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

export async function emitBillingNotificationCandidate(
  candidate: BillingNotificationCandidate,
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC',
) {
  if (!isBillingNotificationEvent(candidate.event)) {
    return { emitted: false };
  }

  await createBillingWebhookNotification({
    eventId: candidate.eventId ?? null,
    eventName: candidate.event,
    asaasPaymentId: candidate.asaasPaymentId,
    occurredAt: normalizeOccurredAt(candidate.occurredAt),
    sourceType,
  });

  return { emitted: true };
}

export async function emitBillingNotifications(
  candidates: BillingNotificationCandidate[],
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC',
) {
  await Promise.all(
    candidates.map((candidate) =>
      emitBillingNotificationCandidate(candidate, sourceType).catch((error) => {
        console.error('[Notifications][billing] Falha não crítica ao criar notificação interna', {
          sourceType,
          event: candidate.event,
          eventId: candidate.eventId ?? null,
          asaasPaymentId: candidate.asaasPaymentId,
          message: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );
}
