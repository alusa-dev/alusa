import { createHash } from 'node:crypto';
import type { WhatsAppWebhookMessage, WhatsAppWebhookRecord, WhatsAppWebhookStatus } from './types';

type UnknownRecord = Record<string, unknown>;

export function hashWebhookBody(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

export function extractWhatsAppWebhookRecords(payload: unknown): WhatsAppWebhookRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];

  const records: WhatsAppWebhookRecord[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : null;
      const phoneNumberId = typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : null;
      if (!phoneNumberId) continue;

      const messages = Array.isArray(value.messages)
        ? value.messages.filter(isWhatsAppMessage).map(toWhatsAppMessage)
        : [];
      const statuses = Array.isArray(value.statuses)
        ? value.statuses.filter(isWhatsAppStatus).map(toWhatsAppStatus)
        : [];

      records.push({ phoneNumberId, messages, statuses });
    }
  }

  return records;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWhatsAppMessage(value: unknown): value is UnknownRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.from === 'string' && typeof value.type === 'string';
}

function isWhatsAppStatus(value: unknown): value is UnknownRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.status === 'string';
}

function toWhatsAppMessage(value: UnknownRecord): WhatsAppWebhookMessage {
  return {
    id: String(value.id),
    from: String(value.from),
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : undefined,
    type: String(value.type),
    text: isRecord(value.text) ? { body: typeof value.text.body === 'string' ? value.text.body : undefined } : undefined,
    image: isRecord(value.image)
      ? {
          id: typeof value.image.id === 'string' ? value.image.id : undefined,
          caption: typeof value.image.caption === 'string' ? value.image.caption : undefined,
          mime_type: typeof value.image.mime_type === 'string' ? value.image.mime_type : undefined,
          sha256: typeof value.image.sha256 === 'string' ? value.image.sha256 : undefined,
        }
      : undefined,
    document: isRecord(value.document)
      ? {
          id: typeof value.document.id === 'string' ? value.document.id : undefined,
          filename: typeof value.document.filename === 'string' ? value.document.filename : undefined,
          caption: typeof value.document.caption === 'string' ? value.document.caption : undefined,
          mime_type: typeof value.document.mime_type === 'string' ? value.document.mime_type : undefined,
          sha256: typeof value.document.sha256 === 'string' ? value.document.sha256 : undefined,
        }
      : undefined,
  };
}

function toWhatsAppStatus(value: UnknownRecord): WhatsAppWebhookStatus {
  return {
    id: String(value.id),
    status: String(value.status),
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : undefined,
    recipient_id: typeof value.recipient_id === 'string' ? value.recipient_id : undefined,
    errors: Array.isArray(value.errors)
      ? value.errors.filter(isRecord).map((error) => ({
          code: typeof error.code === 'number' ? error.code : undefined,
          title: typeof error.title === 'string' ? error.title : undefined,
          message: typeof error.message === 'string' ? error.message : undefined,
        }))
      : undefined,
  };
}
