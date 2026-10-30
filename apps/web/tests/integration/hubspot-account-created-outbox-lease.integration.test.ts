import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { drainHubSpotAccountCreatedOutbox } from '@/src/server/public/hubspot-account-created';

const isTestDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (name === 'alusa_test' || name.startsWith('alusa_test_'));
  } catch {
    return false;
  }
})();

afterAll(async () => prisma.$disconnect());
afterEach(() => vi.unstubAllEnvs());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value: T) => resolve(value) };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!isTestDatabase)('HubSpot account-created outbox lease integration', () => {
  it('prevents an expired lease holder from finalizing after a newer worker takes over', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('HUBSPOT_ACCOUNT_CREATED_DELIVERY_ENABLED', 'true');
    vi.stubEnv('HUBSPOT_PRIVATE_APP_ACCESS_TOKEN', 'integration-token');

    const suffix = randomUUID().replaceAll('-', '');
    const contaId = `hubspot_lease_${suffix}`;
    const userId = `hubspot_owner_${suffix}`;
    const email = `hubspot-lease-${suffix}@example.test`;
    const contaName = `HubSpot lease integration ${suffix}`;
    const searchStarted = deferred<void>();
    const releaseFirstWorker = deferred<void>();
    let firstSearch = true;

    await prisma.conta.create({ data: { id: contaId, nome: contaName } });
    await prisma.usuario.create({
      data: { id: userId, contaId, nome: 'Integration Owner', email, senhaHash: 'integration-only', role: 'ADMIN', status: 'ATIVO' },
    });
    await prisma.conta.update({ where: { id: contaId }, data: { ownerUserId: userId } });
    const outbox = await prisma.hubSpotAccountCreatedOutbox.create({ data: { contaId } });

    const oldWorkerFetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/contacts/') && init?.method !== 'POST') return json({}, 404);
      if (url.endsWith('/crm/v3/objects/contacts') && init?.method === 'POST') return json({ id: 'contact-old' });
      if (url.endsWith('/crm/v3/objects/notes/search') && firstSearch) {
        firstSearch = false;
        searchStarted.resolve();
        await releaseFirstWorker.promise;
        return json({ results: [] });
      }
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) {
        return json({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 202 }] });
      }
      throw new Error(`Unexpected old-worker request: ${url}`);
    });
    const newWorkerFetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/contacts/contact-old')) return json({ id: 'contact-old' });
      if (url.endsWith('/crm/v3/objects/notes/search')) return json({ results: [] });
      if (url.endsWith('/crm/v4/associations/notes/contacts/labels')) {
        return json({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: 202 }] });
      }
      if (url.endsWith('/crm/v3/objects/notes') && init?.method === 'POST') return json({ id: 'note-new' });
      if (url.endsWith('/crm/v3/objects/notes/note-new/associations/contacts/contact-old/202')) return json({});
      throw new Error(`Unexpected new-worker request: ${url}`);
    });

    try {
      const oldWorker = drainHubSpotAccountCreatedOutbox({ fetcher: oldWorkerFetcher });
      await searchStarted.promise;

      await prisma.$executeRaw`UPDATE "HubSpotAccountCreatedOutbox" SET "lockedAt" = CURRENT_TIMESTAMP - INTERVAL '3 minutes' WHERE "id" = ${outbox.id}`;
      const newWorker = await drainHubSpotAccountCreatedOutbox({ fetcher: newWorkerFetcher });
      expect(newWorker).toMatchObject({ claimed: 1, delivered: 1, failed: 0 });
      const deliveredByNewWorker = await prisma.hubSpotAccountCreatedOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(deliveredByNewWorker).toMatchObject({ status: 'DELIVERED', contactId: 'contact-old', noteId: 'note-new', claimToken: null });

      releaseFirstWorker.resolve();
      await oldWorker;
      const finalRow = await prisma.hubSpotAccountCreatedOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
      expect(finalRow).toMatchObject({
        status: 'DELIVERED', contactId: 'contact-old', noteId: 'note-new',
        deliveredAt: deliveredByNewWorker.deliveredAt, claimToken: null,
      });
      expect(oldWorkerFetcher.mock.calls.some(([url, request]) => String(url).endsWith('/crm/v3/objects/notes') && request?.method === 'POST')).toBe(false);
    } finally {
      releaseFirstWorker.resolve();
      await prisma.hubSpotAccountCreatedOutbox.deleteMany({ where: { id: outbox.id } });
      await prisma.conta.update({ where: { id: contaId }, data: { ownerUserId: null } });
      await prisma.usuario.deleteMany({ where: { id: userId } });
      await prisma.conta.deleteMany({ where: { id: contaId } });
    }
  }, 30_000);
});
