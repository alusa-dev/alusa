import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { submitExpertContactLeadToHubSpot } from './hubspot-expert-contact';
import type { ExpertContactLeadStore } from './hubspot-expert-contact';
import type { ExpertContactLeadInputDTO } from '@/features/public/dtos';

const lead: ExpertContactLeadInputDTO = {
  contactName: 'Ana da Silva',
  email: 'ana@example.com',
  institutionName: 'Escola & Cia',
  phone: '(92) 99999-9999',
  institutionType: 'Escola de dança',
  studentsRange: 'Mais de 500',
  requestId: 'e85d4aac-8a64-4f45-87bc-74553df2dcc4',
};
const leadHash = createHash('sha256').update([
  lead.contactName, lead.email, lead.institutionName, lead.institutionWebsite || '', lead.phone,
  lead.institutionType, lead.studentsRange,
].join('\u0000')).digest('hex');

beforeEach(() => {
  vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'hubspot-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createFetcher(handler: (_url: string, _init?: RequestInit) => Promise<Response>) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    return handler(url, init);
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

function defaultHubSpotResponse(url: string, init?: RequestInit): Response | undefined {
  const method = init?.method ?? 'GET';
  if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [] });
  if (url.includes('/crm/v3/objects/contacts/contact-1') && method === 'GET') {
    return jsonResponse({ id: 'contact-1', properties: { firstname: 'Ana', lastname: 'da Silva', phone: '(92) 99999-9999', company: 'Escola & Cia' } });
  }
  if (url.includes('/crm/v3/objects/contacts/') && method === 'GET') return new Response(null, { status: 404 });
  if (url.endsWith('/crm/v3/objects/contacts') && method === 'POST') return jsonResponse({ id: 'contact-1' }, 201);
  if (url.includes('/crm/v3/objects/contacts/') && method === 'PATCH') return jsonResponse({}, 200);
  if (url.endsWith('/crm/v3/objects/companies/search') || url.endsWith('/crm/v3/objects/deals/search')) return jsonResponse({ results: [] });
  if (url.endsWith('/crm/v3/objects/companies') && method === 'POST') return jsonResponse({ id: 'company-1' }, 201);
  if (url.endsWith('/crm/v3/objects/deals') && method === 'POST') return jsonResponse({ id: 'deal-1' }, 201);
  if (url.endsWith('/crm/v3/objects/tasks') && method === 'POST') return jsonResponse({ id: 'task-1' }, 201);
  if (url.endsWith('/crm/v3/objects/tasks/search')) return jsonResponse({ results: [] });
  if (url.includes('/labels') && method === 'GET') {
    const typeId = url.includes('/contacts/companies/') ? 11
      : url.includes('/deals/companies/') ? 12
        : url.includes('/deals/contacts/') ? 13
          : url.includes('/notes/contacts/') ? 14
          : url.includes('/notes/companies/') ? 15 : url.includes('/notes/deals/') ? 16 : 17;
    return jsonResponse({ results: [{ category: 'HUBSPOT_DEFINED', typeId, label: null }] });
  }
  if (method === 'PUT') return new Response(null, { status: 204 });
  if (url.endsWith('/crm/v3/objects/notes') && method === 'POST') return jsonResponse({ id: 'note-1' }, 201);
  return undefined;
}

function createHubSpotFetcher(override?: (_url: string, _init?: RequestInit) => Promise<Response | undefined> | Response | undefined) {
  return createFetcher(async (url, init) => {
    const customResponse = await override?.(url, init);
    if (customResponse) return customResponse;
    const response = defaultHubSpotResponse(url, init);
    if (response) return response;
    throw new Error(`Unexpected HubSpot request: ${url}`);
  });
}

function createMemoryStore(initial?: { requestId?: string; state: 'PENDING' | 'NOTE_CREATING' | 'DELIVERED' | 'EXPIRED'; payloadHash: string; noteId?: string | null; contactId?: string | null }): ExpertContactLeadStore & { getState: () => string; getNoteId: () => string | null; getContactId: () => string | null } {
  type Record = {
    requestId: string;
    state: 'PENDING' | 'NOTE_CREATING' | 'DELIVERED' | 'EXPIRED';
    payloadHash: string | null;
    noteId: string | null;
    noteAttemptedAt: Date | null;
    contactName: string | null;
    email: string | null;
    institutionName: string | null;
    institutionWebsite: string | null;
    phone: string | null;
    institutionType: string | null;
    studentsRange: string | null;
    contactId: string | null;
    companyId: string | null;
    companyAttemptedAt: Date | null;
    dealId: string | null;
    dealAttemptedAt: Date | null;
    taskId: string | null;
    taskAttemptedAt: Date | null;
    updatedAt: number;
  };
  const records = new Map<string, Record>();
  if (initial) {
    records.set(initial.requestId ?? lead.requestId, {
      requestId: initial.requestId ?? lead.requestId,
      state: initial.state,
      payloadHash: initial.payloadHash,
      noteId: initial.noteId ?? null,
      noteAttemptedAt: null,
      contactName: lead.contactName,
      email: lead.email,
      institutionName: lead.institutionName,
      institutionWebsite: lead.institutionWebsite || null,
      phone: lead.phone,
      institutionType: lead.institutionType,
      studentsRange: lead.studentsRange,
      contactId: initial.contactId ?? null,
      companyId: null,
      companyAttemptedAt: null,
      dealId: null,
      dealAttemptedAt: null,
      taskId: null,
      taskAttemptedAt: null,
      updatedAt: Date.now(),
    });
  }
  let captureQueue = Promise.resolve();
  const snapshot = (record: Record): Omit<Record, 'updatedAt'> => {
    const { updatedAt: _updatedAt, ...result } = record;
    return result;
  };
  return {
    async capture(request, payloadHash) {
      let release!: () => void;
      const previous = captureQueue;
      captureQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const byRequestId = records.get(request.requestId);
        if (byRequestId) return snapshot(byRequestId);
        const recentEquivalent = [...records.values()]
          .filter((record) => record.payloadHash === payloadHash && record.updatedAt >= Date.now() - 10 * 60_000)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (recentEquivalent) {
          recentEquivalent.updatedAt = Date.now();
          return snapshot(recentEquivalent);
        }
        const record: Record = {
          requestId: request.requestId,
          state: 'PENDING',
          payloadHash,
          noteId: null,
          noteAttemptedAt: null,
          contactName: request.contactName,
          email: request.email,
          institutionName: request.institutionName,
          institutionWebsite: request.institutionWebsite || null,
          phone: request.phone,
          institutionType: request.institutionType,
          studentsRange: request.studentsRange,
          contactId: null,
          companyId: null,
          companyAttemptedAt: null,
          dealId: null,
          dealAttemptedAt: null,
          taskId: null,
          taskAttemptedAt: null,
          updatedAt: Date.now(),
        };
        records.set(record.requestId, record);
        return snapshot(record);
      } finally {
        release();
      }
    },
    async claimNoteCreation(requestId) {
      const record = records.get(requestId);
      if (!record || record.state !== 'PENDING') return false;
      record.state = 'NOTE_CREATING';
      return true;
    },
    async markDelivered(requestId, noteId) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      if (!noteId.trim()) throw new Error('noteId is required');
      if (record.state === 'DELIVERED' && record.noteId === noteId) return;
      if (record.state !== 'NOTE_CREATING') throw new Error('Lead is not claimed for delivery');
      record.state = 'DELIVERED';
      record.noteId = noteId;
      record.contactName = null;
      record.email = null;
      record.institutionName = null;
      record.institutionWebsite = null;
      record.phone = null;
      record.institutionType = null;
      record.studentsRange = null;
      record.updatedAt = Date.now();
    },
    async recordRemoteObject(requestId, object, id) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      if (!id.trim()) throw new Error('Remote object ID is required');
      const field = object === 'contact' ? 'contactId' : object === 'company' ? 'companyId' : 'dealId';
      const current = record[field];
      if (object !== 'contact' && current && current !== id) throw new Error('Remote object ID conflicts with existing ID');
      record[field] = id;
    },
    async markTaskAttempt(requestId) {
      const record = records.get(requestId);
      if (!record || record.taskAttemptedAt) return false;
      record.taskAttemptedAt = new Date();
      return true;
    },
    async clearTaskAttempt(requestId) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      record.taskAttemptedAt = null;
    },
    async recordTask(requestId, id) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      if (record.taskId && record.taskId !== id) throw new Error('Task ID conflicts');
      record.taskId = id;
    },
    async markRemoteObjectAttempt(requestId, object) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      const field = object === 'company' ? 'companyAttemptedAt' : 'dealAttemptedAt';
      if (record[field] !== null) return false;
      record[field] = new Date();
      return true;
    },
    async clearRemoteObjectAttempt(requestId, object) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      const field = object === 'company' ? 'companyAttemptedAt' : 'dealAttemptedAt';
      record[field] = null;
    },
    async markNoteAttempt(requestId) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      if (record.noteAttemptedAt !== null) return false;
      record.noteAttemptedAt = new Date();
      return true;
    },
    async clearNoteAttempt(requestId) {
      const record = records.get(requestId);
      if (!record) throw new Error('Lead not captured');
      record.noteAttemptedAt = null;
    },
    getState: () => [...records.values()].at(-1)?.state ?? 'MISSING',
    getNoteId: () => [...records.values()].at(-1)?.noteId ?? null,
    getContactId: () => [...records.values()].at(-1)?.contactId ?? null,
  };
}

describe('submitExpertContactLeadToHubSpot', () => {
  it('skips leads with up to 500 students without calling HubSpot or capturing a CRM record', async () => {
    const store = createMemoryStore();
    const { fetcher, calls } = createFetcher(async () => {
      throw new Error('HubSpot must not be called');
    });
    const smallerLead: ExpertContactLeadInputDTO = { ...lead, studentsRange: '101 a 150' };

    await expect(submitExpertContactLeadToHubSpot(smallerLead, { fetcher, store })).resolves.toBeUndefined();

    expect(calls).toHaveLength(0);
    expect(store.getState()).toBe('MISSING');
  });

  it('creates a contact and attaches the complete request as one note', async () => {
    const store = createMemoryStore();
    const { fetcher, calls } = createHubSpotFetcher();

    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store })).resolves.toBeUndefined();

    expect(calls[0]?.url).toBe('https://api.hubapi.com/crm/v3/objects/notes/search');
    expect(calls[1]?.url).toContain('/crm/v3/objects/contacts/ana%40example.com?idProperty=email');
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/companies'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/deals'))).toBe(true);
    const associations = calls.filter((call) => call.method === 'PUT' && call.url.includes('/crm/v4/objects/'));
    expect(associations).toHaveLength(4);
    expect(associations.map(({ url, body }) => ({
      url: url.replace('https://api.hubapi.com', ''),
      body: body ? JSON.parse(body) : null,
    }))).toEqual(expect.arrayContaining([
      { url: '/crm/v4/objects/contacts/contact-1/associations/companies/company-1', body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 11 }] },
      { url: '/crm/v4/objects/deals/deal-1/associations/companies/company-1', body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 12 }] },
      { url: '/crm/v4/objects/deals/deal-1/associations/contacts/contact-1', body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 13 }] },
      { url: '/crm/v4/objects/tasks/task-1/associations/deals/deal-1', body: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 17 }] },
    ]));
    const noteCreate = calls.find((call) => call.url.endsWith('/crm/v3/objects/notes') && call.method === 'POST');
    expect(noteCreate?.body && JSON.parse(noteCreate.body).associations).toEqual([
      { to: { id: 'contact-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 14 }] },
      { to: { id: 'company-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 15 }] },
      { to: { id: 'deal-1' }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }] },
    ]);
    expect(calls.filter((call) => call.url.endsWith('/crm/v3/objects/notes'))).toHaveLength(1);
    expect(store.getState()).toBe('DELIVERED');
    expect(store.getNoteId()).toBe('note-1');
  });

  it('recovers a stale persisted contact ID by finding the contact by email and persisting its new ID', async () => {
    const store = createMemoryStore({ state: 'NOTE_CREATING', payloadHash: leadHash, contactId: 'deleted-contact' });
    const { fetcher, calls } = createHubSpotFetcher((url, init) => {
      if (url.includes('/contacts/deleted-contact?')) return jsonResponse({}, 404);
      if (url.includes('/contacts/ana%40example.com?')) return jsonResponse({ id: 'contact-recovered', properties: { email: lead.email } });
      if (url.includes('/contacts/contact-recovered') && init?.method === 'PATCH') return jsonResponse({});
      return undefined;
    });

    await submitExpertContactLeadToHubSpot(lead, { fetcher, store });

    expect(calls.some((call) => call.url.includes('/contacts/ana%40example.com?'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/contacts') && call.method === 'POST')).toBe(false);
    expect(store.getContactId()).toBe('contact-recovered');
  });

  it('creates and persists a replacement when a stale contact ID and email lookup both return 404', async () => {
    const store = createMemoryStore({ state: 'NOTE_CREATING', payloadHash: leadHash, contactId: 'deleted-contact' });
    const { fetcher } = createHubSpotFetcher((url) => {
      if (url.includes('/contacts/deleted-contact?') || url.includes('/contacts/ana%40example.com?')) return jsonResponse({}, 404);
      if (url.endsWith('/crm/v3/objects/contacts')) return jsonResponse({ id: 'contact-created' }, 201);
      if (url.includes('/contacts/contact-created?')) return jsonResponse({ id: 'contact-created', properties: {} });
      return undefined;
    });

    await submitExpertContactLeadToHubSpot(lead, { fetcher, store });
    expect(store.getContactId()).toBe('contact-created');
  });

  it('rereads by email and persists the contact after a replacement create conflict', async () => {
    const store = createMemoryStore({ state: 'NOTE_CREATING', payloadHash: leadHash, contactId: 'deleted-contact' });
    const { fetcher, calls } = createHubSpotFetcher((url, init) => {
      if (url.includes('/contacts/deleted-contact?')) return jsonResponse({}, 404);
      if (url.includes('/contacts/ana%40example.com?')) {
        if (init?.method === 'GET' && calls.filter((call) => call.url.includes('/contacts/ana%40example.com?')).length === 1) return jsonResponse({}, 404);
        return jsonResponse({ id: 'contact-raced', properties: { email: lead.email } });
      }
      if (url.endsWith('/crm/v3/objects/contacts') && init?.method === 'POST') return jsonResponse({}, 409);
      if (url.includes('/contacts/contact-raced') && init?.method === 'PATCH') return jsonResponse({});
      return undefined;
    });

    await submitExpertContactLeadToHubSpot(lead, { fetcher, store });
    expect(store.getContactId()).toBe('contact-raced');
    expect(calls.filter((call) => call.url.includes('/contacts/ana%40example.com?'))).toHaveLength(2);
  });

  it('does not fall back to email lookup or create when the persisted contact lookup fails with a non-404', async () => {
    const store = createMemoryStore({ state: 'NOTE_CREATING', payloadHash: leadHash, contactId: 'contact-existing' });
    const { fetcher, calls } = createHubSpotFetcher((url) => {
      if (url.includes('/contacts/contact-existing?')) return jsonResponse({}, 503);
      return undefined;
    });

    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store })).rejects.toMatchObject({ code: 'provider_error' });
    expect(calls.some((call) => call.url.includes('/contacts/ana%40example.com?'))).toBe(false);
    expect(calls.some((call) => call.url.endsWith('/crm/v3/objects/contacts') && call.method === 'POST')).toBe(false);
  });

  it('allows only one concurrent submission with the same request ID to create a note', async () => {
    const store = createMemoryStore();
    const { fetcher, calls } = createHubSpotFetcher();

    const results = await Promise.allSettled([
      submitExpertContactLeadToHubSpot(lead, { fetcher, store }),
      submitExpertContactLeadToHubSpot(lead, { fetcher, store }),
    ]);

    expect(calls.filter((call) => call.url.endsWith('/crm/v3/objects/notes') && call.method === 'POST')).toHaveLength(1);
    expect(store.getState()).toBe('DELIVERED');
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('deduplicates concurrent identical submissions with different request IDs', async () => {
    const store = createMemoryStore();
    const secondLead = { ...lead, requestId: '12a374e1-8c39-4522-9d77-09d54e6b2a31' };
    const { fetcher, calls } = createHubSpotFetcher(async (url, init) => {
      if (url.endsWith('/crm/v3/objects/notes') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { properties: { hs_note_body: string } };
        expect(body.properties.hs_note_body).toContain(lead.requestId);
        expect(body.properties.hs_note_body).not.toContain(secondLead.requestId);
        return jsonResponse({ id: 'note-1' }, 201);
      }
      return undefined;
    });

    const results = await Promise.allSettled([
      submitExpertContactLeadToHubSpot(lead, { fetcher, store }),
      submitExpertContactLeadToHubSpot(secondLead, { fetcher, store }),
    ]);
    expect(calls.filter((call) => call.url.endsWith('/crm/v3/objects/notes') && call.method === 'POST')).toHaveLength(1);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(store.getState()).toBe('DELIVERED');
  });

  it('fails closed after an ambiguous note timeout and does not retry the non-idempotent POST', async () => {
    const store = createMemoryStore();
    let notePosts = 0;
    const { fetcher } = createHubSpotFetcher(async (url, init) => {
      if (url.endsWith('/crm/v3/objects/notes') && init?.method === 'POST') {
        notePosts += 1;
        throw new Error('connection closed after request');
      }
      return undefined;
    });

    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store }))
      .rejects.toMatchObject({ code: 'ambiguous' });
    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store }))
      .rejects.toMatchObject({ code: 'ambiguous' });
    expect(notePosts).toBe(1);
    expect(store.getState()).toBe('NOTE_CREATING');
  });

  it('reconciles an ambiguous note only when HubSpot search positively finds it', async () => {
    const store = createMemoryStore();
    let firstSearch = true;
    let notePosts = 0;
    const { fetcher, calls } = createHubSpotFetcher(async (url, init) => {
      if (url.endsWith('/crm/v3/objects/notes/search')) {
        if (firstSearch) { firstSearch = false; return jsonResponse({ results: [] }); }
        return jsonResponse({ results: [{ id: 'note-existing' }] });
      }
      if (url.endsWith('/crm/v3/objects/notes') && init?.method === 'POST') {
        notePosts += 1;
        throw new Error('connection closed after request');
      }
      return undefined;
    });

    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store }))
      .rejects.toMatchObject({ code: 'ambiguous' });
    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store })).resolves.toBeUndefined();
    expect(notePosts).toBe(1);
    expect(calls.filter((call) => call.url.endsWith('/crm/v3/objects/notes/search'))).toHaveLength(2);
    expect(store.getState()).toBe('DELIVERED');
    expect(store.getNoteId()).toBe('note-existing');
  });

  it('does not mark a successful HTTP response as delivered if the note ID is absent', async () => {
    const store = createMemoryStore();
    const { fetcher } = createHubSpotFetcher(async (url, init) => {
      if (url.endsWith('/crm/v3/objects/notes') && init?.method === 'POST') return jsonResponse({}, 201);
      return undefined;
    });

    await expect(submitExpertContactLeadToHubSpot(lead, { fetcher, store }))
      .rejects.toMatchObject({ code: 'ambiguous' });
    expect(store.getState()).toBe('NOTE_CREATING');
    expect(store.getNoteId()).toBeNull();
  });

  it('rejects reuse of a request ID for changed form data', async () => {
    const store = createMemoryStore();
    const changed = { ...lead, institutionName: 'Outra escola' };
    const { fetcher } = createFetcher(async () => new Response(null, { status: 403 }));
    await expect(submitExpertContactLeadToHubSpot(lead, { store, fetcher }))
      .rejects.toMatchObject({ code: 'provider_error' });
    await expect(submitExpertContactLeadToHubSpot(changed, { store, fetcher }))
      .rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
});
