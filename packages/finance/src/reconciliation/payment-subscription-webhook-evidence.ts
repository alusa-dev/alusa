import type { Prisma } from '@prisma/client';

export type PaymentSubscriptionWebhookIdentity = {
  contaId: string;
  paymentId: string;
  subscriptionId: string;
  causeId: string;
  event: string;
};

type WebhookEvidenceRow = {
  contaId: string;
  eventId: string | null;
  event: string;
  paymentId: string | null;
  payloadId: string | null;
  payloadEvent: string | null;
  payloadPaymentId: string | null;
  subscriptionId: string | null;
};

/**
 * The validated envelope ID is authoritative. Legacy handlers sometimes used
 * the fully redacted payload ID instead. Accept that exact alias only when all
 * matching live/archive rows identify one canonical event and the same payment,
 * parent and event type. Never reconstruct IDs or match masked prefixes.
 */
export async function resolvePaymentSubscriptionWebhookEvidence(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: PaymentSubscriptionWebhookIdentity,
): Promise<string | null> {
  if (!input.contaId || !input.paymentId || !input.subscriptionId || !input.causeId || !input.event.startsWith('PAYMENT_')) return null;
  const rows = await db.$queryRaw<WebhookEvidenceRow[]>`
    SELECT w."contaId", w."eventId", w.evento AS event, w."asaasPaymentId" AS "paymentId",
      w.payload ->> 'id' AS "payloadId", w.payload ->> 'event' AS "payloadEvent",
      w.payload #>> '{payment,id}' AS "payloadPaymentId",
      w.payload #>> '{payment,subscription}' AS "subscriptionId"
    FROM "WebhookAsaas" w
    WHERE w."contaId" = ${input.contaId} AND w."asaasPaymentId" = ${input.paymentId}
      AND (w."eventId" = ${input.causeId} OR w.payload ->> 'id' = ${input.causeId})
    UNION ALL
    SELECT w."contaId", w."eventId", w.evento AS event, w."asaasPaymentId" AS "paymentId",
      w.payload ->> 'id' AS "payloadId", w.payload ->> 'event' AS "payloadEvent",
      w.payload #>> '{payment,id}' AS "payloadPaymentId",
      w.payload #>> '{payment,subscription}' AS "subscriptionId"
    FROM "WebhookAsaasArchive" w
    WHERE w."contaId" = ${input.contaId} AND w."asaasPaymentId" = ${input.paymentId}
      AND (w."eventId" = ${input.causeId} OR w.payload ->> 'id' = ${input.causeId})
    LIMIT 201
  `;
  if (rows.length === 0 || rows.length > 200) return null;
  const canonicalIds = new Set<string>();
  for (const row of rows) {
    if (row.contaId !== input.contaId || row.paymentId !== input.paymentId || row.payloadPaymentId !== input.paymentId ||
        row.subscriptionId !== input.subscriptionId || row.event !== input.event || row.payloadEvent !== input.event ||
        !row.eventId?.trim() || (row.eventId !== input.causeId && row.payloadId !== input.causeId)) return null;
    canonicalIds.add(row.eventId);
  }
  return canonicalIds.size === 1 ? [...canonicalIds][0]! : null;
}
