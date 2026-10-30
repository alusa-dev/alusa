import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainHubSpotAccountCreatedOutbox } from './hubspot-account-created';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeDb(event: Record<string, unknown>) {
  const updates: Array<Record<string, unknown>> = [];
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'outbox-1', contaId: 'conta-1', attempts: 1, claimToken: 'claim-1' }]) };
  const db = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    hubSpotAccountCreatedOutbox: {
      findFirst: vi.fn().mockResolvedValue(event),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        Object.assign(event, data);
        return { count: 1 };
      }),
    },
    conta: { findFirst: vi.fn().mockResolvedValue({ id: 'conta-1', ownerUserId: 'owner-1', createdAt: new Date('2026-10-01T12:00:00Z') }) },
    usuario: { findFirst: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'owner@example.test', nome: 'Ana Escola' }) },
  };
  return { db, updates, tx };
}

describe('HubSpot account-created outbox', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('does not call HubSpot outside explicitly enabled production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    const fetcher = vi.fn();

    await expect(drainHubSpotAccountCreatedOutbox({ fetcher })).resolves.toMatchObject({ skipped: true, claimed: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('compares due times in UTC while keeping the lease check on the same DB clock', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const { db, tx } = makeDb({});
    tx.$queryRaw.mockResolvedValue([]);

    await expect(drainHubSpotAccountCreatedOutbox({ db: db as never })).resolves.toMatchObject({ claimed: 0, skipped: false });

    const queryTemplate = tx.$queryRaw.mock.calls[0]?.[0];
    const queryText = Array.isArray(queryTemplate) ? queryTemplate.join('?') : '';
    expect(queryText).toContain('"availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE \'UTC\')');
    expect(queryText).toContain('"lockedAt" < CURRENT_TIMESTAMP - INTERVAL \'2 minutes\'');
  });

  it('allows delivery in local development only with the explicit local opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_LOCAL_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const event = { id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: 'claim-1', attempts: 1, contactId: null, noteId: null, noteAttemptedAt: null };
    const { db } = makeDb(event);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/contacts/owner%40example.test')) return jsonResponse({}, 404);
      if (url.endsWith('/crm/v3/objects/contacts') && method === 'POST') return jsonResponse({ id: 'contact-1' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [] });
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) return jsonResponse({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 202 }] });
      if (url.endsWith('/crm/v3/objects/notes') && method === 'POST') return jsonResponse({ id: 'note-1' });
      if (url.endsWith('/crm/v3/objects/notes/note-1/associations/contacts/contact-1/202')) return jsonResponse({});
      throw new Error(`Unexpected mocked HubSpot request: ${method} ${url}`);
    });

    const result = await drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher });

    expect(result).toMatchObject({ claimed: 1, delivered: 1, failed: 0, skipped: false });
    expect(fetcher).toHaveBeenCalled();
  });

  it.each([
    ['local development without opt-in', 'development', '', '', 'false'],
    ['local development with production flag only', 'development', '', 'true', 'false'],
    ['test runtime despite local opt-in', 'test', '', '', 'true'],
    ['preview deployment despite local opt-in', 'production', 'preview', '', 'true'],
    ['production despite local opt-in', 'production', 'production', '', 'true'],
  ])('does not allow local delivery in %s', async (_scenario, nodeEnv, vercelEnv, productionFlag, localFlag) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_LOCAL_DELIVERY_ENABLED', localFlag);
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', productionFlag);
    const fetcher = vi.fn();
    const { db } = makeDb({});

    await expect(drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher })).resolves.toMatchObject({ skipped: true, claimed: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('upserts only the owner Contact and records an idempotent account-created Note', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const event = { id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: 'claim-1', attempts: 1, contactId: null, noteId: null, noteAttemptedAt: null };
    const { db, updates } = makeDb(event);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/contacts/owner%40example.test')) return jsonResponse({}, 404);
      if (url.endsWith('/crm/v3/objects/contacts') && method === 'POST') return jsonResponse({ id: 'contact-1' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [] });
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) return jsonResponse({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 202 }] });
      if (url.endsWith('/crm/v3/objects/notes') && method === 'POST') return jsonResponse({ id: 'note-1' });
      if (url.endsWith('/crm/v3/objects/notes/note-1/associations/contacts/contact-1/202')) return jsonResponse({});
      throw new Error(`Unexpected mocked HubSpot request: ${method} ${url}`);
    });

    const result = await drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher });

    expect(result).toMatchObject({ claimed: 1, delivered: 1, failed: 0, skipped: false });
    expect(db.usuario.findFirst).toHaveBeenCalledWith({ where: { id: 'owner-1', contaId: 'conta-1' }, select: { id: true, email: true, nome: true } });
    expect(updates).toContainEqual(expect.objectContaining({ status: 'DELIVERED', contactId: 'contact-1', noteId: 'note-1' }));
    const calledUrls = fetcher.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes('/companies') || url.includes('/deals'))).toBe(false);
    const noteRequest = fetcher.mock.calls.find(([url, init]) => String(url).endsWith('/crm/v3/objects/notes') && init?.method === 'POST');
    expect(JSON.parse(String(noteRequest?.[1]?.body)).properties.hs_note_body).toContain('contaId: conta-1');
    const associationRequest = fetcher.mock.calls.find(([url]) => String(url).endsWith('/crm/v3/objects/notes/note-1/associations/contacts/contact-1/202'));
    expect(associationRequest?.[1]?.method).toBe('PUT');
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/crm/v4/objects/notes/'))).toBe(false);
  });

  it('does not create a second Note after an ambiguous previous attempt', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const event = { id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: 'claim-1', attempts: 2, contactId: 'contact-1', noteId: null, noteAttemptedAt: new Date() };
    const { db } = makeDb(event);
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/contacts/contact-1')) return jsonResponse({ id: 'contact-1' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [] });
      throw new Error(`Unexpected mocked HubSpot request: ${url}`);
    });

    const result = await drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher });

    expect(result.failed).toBe(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/crm/v3/objects/notes'))).toBe(false);
  });

  it('leaves note creation unclaimed when association metadata lookup fails before POST', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const event = { id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: 'claim-1', attempts: 1, contactId: 'contact-1', noteId: null, noteAttemptedAt: null };
    const { db, updates } = makeDb(event);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/contacts/contact-1')) return jsonResponse({ id: 'contact-1' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [] });
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) return jsonResponse({}, 503);
      throw new Error(`Unexpected mocked HubSpot request: ${url}`);
    });

    const result = await drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher });

    expect(result.failed).toBe(1);
    expect(updates.some((data) => Object.hasOwn(data, 'noteAttemptedAt'))).toBe(false);
  });

  it('clears note-attempt marker after a definite rate-limit rejection so retry can create it', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const event = { id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: 'claim-1', attempts: 1, contactId: 'contact-1', noteId: null, noteAttemptedAt: null };
    const { db, updates } = makeDb(event);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/contacts/contact-1')) return jsonResponse({ id: 'contact-1' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [] });
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) return jsonResponse({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 202 }] });
      if (url.endsWith('/crm/v3/objects/notes') && init?.method === 'POST') return jsonResponse({}, 429);
      throw new Error(`Unexpected mocked HubSpot request: ${url}`);
    });

    const result = await drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher });

    expect(result.failed).toBe(1);
    expect(updates).toContainEqual(expect.objectContaining({ noteAttemptedAt: null }));
  });

  it('reconciles an existing matching Note and repairs its Contact association', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'test-token');
    const event = { id: 'outbox-1', contaId: 'conta-1', status: 'PROCESSING', claimToken: 'claim-1', attempts: 2, contactId: 'contact-1', noteId: null, noteAttemptedAt: new Date() };
    const { db, updates } = makeDb(event);
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/contacts/contact-1')) return jsonResponse({ id: 'contact-1' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return jsonResponse({ results: [{ id: 'existing-note' }] });
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) return jsonResponse({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 202 }] });
      if (url.endsWith('/crm/v3/objects/notes/existing-note/associations/contacts/contact-1/202')) return jsonResponse({});
      throw new Error(`Unexpected mocked HubSpot request: ${url}`);
    });

    const result = await drainHubSpotAccountCreatedOutbox({ db: db as never, fetcher });

    expect(result.delivered).toBe(1);
    expect(updates).toContainEqual(expect.objectContaining({ status: 'DELIVERED', noteId: 'existing-note' }));
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/crm/v3/objects/notes/existing-note/associations/contacts/contact-1/202'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/crm/v4/objects/notes/'))).toBe(false);
    expect(fetcher.mock.calls.some(([url, init]) => String(url).endsWith('/crm/v3/objects/notes') && init?.method === 'POST')).toBe(false);
  });
});
