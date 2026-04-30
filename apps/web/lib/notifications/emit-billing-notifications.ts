import { createBillingWebhookNotification, isBillingNotificationEvent } from '@alusa/lib';

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
  // Date-only string (YYYY-MM-DD): sem componente de tempo, seria interpretado como
  // meia-noite UTC — usar undefined para que triggeredAt seja o momento de processamento.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  // Formato Asaas sem timezone ("2026-03-24 20:00:00"): horário em BRT (America/Sao_Paulo, UTC-3).
  // Converter explicitamente para evitar interpretação incorreta em servidores UTC.
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
      })
    )
  );
}
