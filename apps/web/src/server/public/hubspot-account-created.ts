import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const API_BASE = 'https://api.hubapi.com';
const TIMEOUT_MS = 8_000;
const MAX_BATCH = 1;
const LEASE_MS = 2 * 60_000;

type ClaimedOutbox = { id: string; contaId: string; attempts: number; claimToken: string };
type HubSpotObject = { id?: string; properties?: Record<string, string | null> };
type SearchResult = { results?: HubSpotObject[] };
type AssociationLabels = { results?: Array<{ category?: string; label?: string | null; typeId?: number }> };

export class HubSpotAccountCreatedError extends Error {
  constructor(readonly code: 'not_enabled' | 'not_configured' | 'timeout' | 'provider_error' | 'invalid_response' | 'ambiguous' | 'missing_owner') {
    super(`HubSpot account-created delivery failed: ${code}`);
    this.name = 'HubSpotAccountCreatedError';
  }
}

function canDeliver(): boolean {
  const productionDeliveryEnabled = process.env.VERCEL_ENV === 'production'
    && process.env.HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED === 'true';
  const localDeliveryEnabled = process.env.NODE_ENV === 'development'
    && !process.env.VERCEL_ENV?.trim()
    && process.env.HUBSPOT_ACCOUNT_CREATED_LOCAL_DELIVERY_ENABLED === 'true';

  return productionDeliveryEnabled || localDeliveryEnabled;
}

function getNameParts(name: string) {
  const [firstName, ...lastParts] = name.trim().split(/\s+/);
  return { firstName, lastName: lastParts.join(' ') };
}

async function requestHubSpot(path: string, init: RequestInit, fetcher: typeof fetch, token: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetcher(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
      cache: 'no-store',
    });
  } catch {
    throw new HubSpotAccountCreatedError(controller.signal.aborted ? 'timeout' : 'provider_error');
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | null;
  if (body === null) throw new HubSpotAccountCreatedError('invalid_response');
  return body;
}

function objectId(value: HubSpotObject | null): string {
  if (typeof value?.id !== 'string' || !value.id.trim()) throw new HubSpotAccountCreatedError('invalid_response');
  return value.id.trim();
}

async function getNoteId(body: string, fetcher: typeof fetch, token: string): Promise<string | null> {
  const response = await requestHubSpot('/crm/v3/objects/notes/search', {
    method: 'POST',
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'hs_note_body', operator: 'EQ', value: body }] }], properties: ['hs_note_body'], limit: 2 }),
  }, fetcher, token);
  if (!response.ok) throw new HubSpotAccountCreatedError('provider_error');
  const results = (await parseJson<SearchResult>(response)).results;
  if (!Array.isArray(results) || results.length > 1) throw new HubSpotAccountCreatedError('ambiguous');
  const id = results[0]?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

async function getNoteContactAssociationId(fetcher: typeof fetch, token: string): Promise<number> {
  const response = await requestHubSpot('/crm/v4/associations/notes/contacts/labels', { method: 'GET' }, fetcher, token);
  if (!response.ok) throw new HubSpotAccountCreatedError('provider_error');
  const labels = (await parseJson<AssociationLabels>(response)).results ?? [];
  const association = labels.find((item) => item.category === 'HUBSPOT_DEFINED' && item.label == null && Number.isInteger(item.typeId));
  if (!association?.typeId) throw new HubSpotAccountCreatedError('invalid_response');
  return association.typeId;
}

async function deliverOne(input: {
  contaId: string;
  owner: { id: string; email: string; nome: string };
  createdAt: Date;
  contactId?: string | null;
  noteId?: string | null;
  noteAttemptedAt?: Date | null;
  persistContact: (contactId: string) => Promise<void>;
  claimNoteAttempt: () => Promise<boolean>;
  clearNoteAttempt: () => Promise<void>;
  fetcher: typeof fetch;
  token: string;
}): Promise<{ contactId: string; noteId: string }> {
  const { firstName, lastName } = getNameParts(input.owner.nome);
  let contact: HubSpotObject | null = null;
  if (input.contactId) {
    const response = await requestHubSpot(`/crm/v3/objects/contacts/${encodeURIComponent(input.contactId)}?properties=email`, { method: 'GET' }, input.fetcher, input.token);
    if (!response.ok) throw new HubSpotAccountCreatedError('provider_error');
    contact = await parseJson<HubSpotObject>(response);
  } else {
    const contactPath = `/crm/v3/objects/contacts/${encodeURIComponent(input.owner.email)}?idProperty=email&properties=email`;
    const read = await requestHubSpot(contactPath, { method: 'GET' }, input.fetcher, input.token);
    if (read.ok) contact = await parseJson<HubSpotObject>(read);
    else if (read.status === 404) {
      const create = await requestHubSpot('/crm/v3/objects/contacts', {
        method: 'POST',
        body: JSON.stringify({ properties: { email: input.owner.email, firstname: firstName, ...(lastName ? { lastname: lastName } : {}) } }),
      }, input.fetcher, input.token);
      if (create.ok) contact = await parseJson<HubSpotObject>(create);
      else if (create.status === 409) {
        const raced = await requestHubSpot(contactPath, { method: 'GET' }, input.fetcher, input.token);
        if (!raced.ok) throw new HubSpotAccountCreatedError('ambiguous');
        contact = await parseJson<HubSpotObject>(raced);
      } else throw new HubSpotAccountCreatedError(create.status >= 500 ? 'ambiguous' : 'provider_error');
    } else throw new HubSpotAccountCreatedError('provider_error');
  }

  const contactId = objectId(contact);
  await input.persistContact(contactId);
  const noteBody = `Conta criada na Alusa.\ncontaId: ${input.contaId}\nCriada em: ${input.createdAt.toISOString()}`;
  let noteId = input.noteId ?? await getNoteId(noteBody, input.fetcher, input.token);
  const associationTypeId = await getNoteContactAssociationId(input.fetcher, input.token);
  if (!noteId) {
    // Once a POST may have reached HubSpot, retries only search for its stable note body.
    // This avoids duplicate notes when a response was lost or indexing is delayed.
    if (input.noteAttemptedAt) throw new HubSpotAccountCreatedError('ambiguous');
    if (!await input.claimNoteAttempt()) throw new HubSpotAccountCreatedError('ambiguous');
    const noteResponse = await requestHubSpot('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: { hs_timestamp: input.createdAt.toISOString(), hs_note_body: noteBody },
        associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId }] }],
      }),
    }, input.fetcher, input.token);
    if (!noteResponse.ok) {
      if (noteResponse.status < 500 && noteResponse.status !== 408) await input.clearNoteAttempt();
      throw new HubSpotAccountCreatedError(noteResponse.status >= 500 || noteResponse.status === 408 ? 'ambiguous' : 'provider_error');
    }
    noteId = objectId(await parseJson<HubSpotObject>(noteResponse));
  }
  const association = await requestHubSpot(`/crm/v3/objects/notes/${encodeURIComponent(noteId)}/associations/contacts/${encodeURIComponent(contactId)}/${associationTypeId}`, { method: 'PUT', body: JSON.stringify({}) }, input.fetcher, input.token);
  if (!association.ok && association.status !== 409) throw new HubSpotAccountCreatedError('provider_error');
  return { contactId, noteId };
}

/** Claims due rows with SKIP LOCKED and a lease token so concurrent job runs cannot deliver the same event. */
export async function drainHubSpotAccountCreatedOutbox(input: {
  db?: PrismaClient;
  fetcher?: typeof fetch;
  limit?: number;
} = {}): Promise<{ claimed: number; delivered: number; failed: number; skipped: boolean }> {
  if (!canDeliver()) return { claimed: 0, delivered: 0, failed: 0, skipped: true };
  const db = input.db ?? prisma;
  const token = process.env.HUBSPOT_PRIVATE_APP_ACCESS_TOKEN?.trim();
  if (!token) throw new HubSpotAccountCreatedError('not_configured');
  const fetcher = input.fetcher ?? fetch;
  const limit = 1;
  const workerId = randomUUID();
  const records = await db.$transaction((tx) => tx.$queryRaw<ClaimedOutbox[]>`
    UPDATE "HubSpotAccountCreatedOutbox"
    SET "status" = 'PROCESSING', "claimToken" = ${workerId}, "lockedAt" = CURRENT_TIMESTAMP,
        "attempts" = "attempts" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" IN (
      SELECT "id" FROM "HubSpotAccountCreatedOutbox"
      WHERE (
        ("status" IN ('PENDING', 'FAILED') AND "availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
        OR ("status" = 'PROCESSING' AND "lockedAt" < CURRENT_TIMESTAMP - INTERVAL '2 minutes')
      )
      ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING "id", "contaId", "attempts", "claimToken"
  `);
  let delivered = 0;
  let failed = 0;
  for (const record of records) {
    try {
      const event = await db.hubSpotAccountCreatedOutbox.findFirst({ where: { id: record.id, contaId: record.contaId, status: 'PROCESSING', claimToken: record.claimToken } });
      if (!event) continue;
      const conta = await db.conta.findFirst({ where: { id: record.contaId }, select: { id: true, ownerUserId: true, createdAt: true } });
      if (!conta?.ownerUserId) throw new HubSpotAccountCreatedError('missing_owner');
      const owner = await db.usuario.findFirst({ where: { id: conta.ownerUserId, contaId: conta.id }, select: { id: true, email: true, nome: true } });
      if (!owner) throw new HubSpotAccountCreatedError('missing_owner');
      const result = await deliverOne({
        contaId: conta.id, owner, createdAt: conta.createdAt, contactId: event.contactId, noteId: event.noteId,
        noteAttemptedAt: event.noteAttemptedAt, fetcher, token,
        persistContact: async (contactId) => {
          const saved = await db.hubSpotAccountCreatedOutbox.updateMany({
            where: { id: event.id, contaId: event.contaId, status: 'PROCESSING', claimToken: record.claimToken },
            data: { contactId },
          });
          if (saved.count !== 1) throw new HubSpotAccountCreatedError('ambiguous');
        },
        claimNoteAttempt: async () => {
          const claimed = await db.hubSpotAccountCreatedOutbox.updateMany({
            where: { id: event.id, contaId: event.contaId, status: 'PROCESSING', claimToken: record.claimToken, noteAttemptedAt: null },
            data: { noteAttemptedAt: new Date() },
          });
          return claimed.count === 1;
        },
        clearNoteAttempt: async () => {
          await db.hubSpotAccountCreatedOutbox.updateMany({
            where: { id: event.id, contaId: event.contaId, status: 'PROCESSING', claimToken: record.claimToken },
            data: { noteAttemptedAt: null },
          });
        },
      });
      const update = await db.hubSpotAccountCreatedOutbox.updateMany({
        where: { id: event.id, contaId: event.contaId, status: 'PROCESSING', claimToken: record.claimToken },
        data: { ...result, status: 'DELIVERED', deliveredAt: new Date(), lockedAt: null, claimToken: null, lastError: null },
      });
      if (update.count === 1) delivered += 1;
    } catch (error) {
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(record.attempts - 1, 7));
      const message = error instanceof HubSpotAccountCreatedError ? error.code : 'provider_error';
      await db.hubSpotAccountCreatedOutbox.updateMany({
        where: { id: record.id, contaId: record.contaId, status: 'PROCESSING', claimToken: record.claimToken },
        data: { status: 'FAILED', availableAt: new Date(Date.now() + delayMs), lockedAt: null, claimToken: null, lastError: message },
      });
      failed += 1;
    }
  }
  return { claimed: records.length, delivered, failed, skipped: false };
}
