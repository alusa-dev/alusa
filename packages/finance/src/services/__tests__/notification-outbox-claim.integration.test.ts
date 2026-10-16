import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  applyPreferences: vi.fn(),
  ensureNotificationsEnabled: vi.fn(),
  syncPreferences: vi.fn(),
  auditRecord: vi.fn(),
}));

vi.mock('../asaas-notification-preferences.service', () => ({
  applyAsaasNotificationPreferencesToCustomer: mocks.applyPreferences,
  listCustomerIdsWithAsaas: vi.fn(),
}));
vi.mock('../customer-notification.service', () => ({
  ensureCustomerNotificationsEnabled: mocks.ensureNotificationsEnabled,
}));
vi.mock('../sync-customer-notifications-at-charge', () => ({
  syncCustomerNotificationsForUserSelection: mocks.syncPreferences,
  channelPreferencesFromWizardSelection: (channels: string[]) => ({
    email: channels.includes('EMAIL'),
    sms: channels.includes('SMS'),
    whatsapp: channels.includes('WHATSAPP'),
  }),
}));
vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: mocks.auditRecord },
}));

const safeTestDatabase = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    return ['postgres:', 'postgresql:'].includes(url.protocol.toLowerCase())
      && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (databaseName === 'alusa_test' || databaseName.startsWith('alusa_test_'));
  } catch {
    return false;
  }
})();
const db = safeTestDatabase ? new PrismaClient() : null;
let processPreferenceOutbox: typeof import('../asaas-notification-preference-outbox.service')['processAsaasNotificationPreferenceOutbox'] | undefined;
let processSyncOutbox: typeof import('../asaas-notification-sync-outbox.service')['processAsaasNotificationSyncOutbox'] | undefined;

describe.skipIf(!safeTestDatabase)('notification outbox fencing PostgreSQL integration', () => {
  const database = db as PrismaClient;
  let contaAId: string;
  let contaBId: string;
  let preferenceAId: string;
  let preferenceBId: string;
  let syncAId: string;
  let syncBId: string;

  beforeAll(async () => {
    const [preferenceOutbox, syncOutbox] = await Promise.all([
      import('../asaas-notification-preference-outbox.service'),
      import('../asaas-notification-sync-outbox.service'),
    ]);
    processPreferenceOutbox = preferenceOutbox.processAsaasNotificationPreferenceOutbox;
    processSyncOutbox = syncOutbox.processAsaasNotificationSyncOutbox;

    const suffix = randomUUID().replaceAll('-', '');
    const cpfA = `00${suffix.slice(0, 12)}`;
    const cpfB = `01${suffix.slice(0, 12)}`;
    const [contaA, contaB] = await Promise.all([
      database.conta.create({ data: { nome: `Outbox claim A ${suffix}`, cpfCnpj: cpfA } }),
      database.conta.create({ data: { nome: `Outbox claim B ${suffix}`, cpfCnpj: cpfB } }),
    ]);
    contaAId = contaA.id;
    contaBId = contaB.id;
    preferenceAId = `preference_a_${suffix}`;
    preferenceBId = `preference_b_${suffix}`;
    syncAId = `sync_a_${suffix}`;
    syncBId = `sync_b_${suffix}`;

    await database.asaasNotificationPreferenceOutbox.createMany({
      data: [
        {
          id: preferenceAId,
          contaId: contaAId,
          asaasCustomerId: `cus-preference-a-${suffix}`,
          dedupeKey: `preference-a-${suffix}`,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(Date.now() - 60_000),
        },
        {
          id: preferenceBId,
          contaId: contaBId,
          asaasCustomerId: `cus-preference-b-${suffix}`,
          dedupeKey: `preference-b-${suffix}`,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(Date.now() - 60_000),
        },
      ],
    });
    await database.asaasNotificationSyncOutbox.createMany({
      data: [
        {
          id: syncAId,
          contaId: contaAId,
          asaasCustomerId: `cus-sync-a-${suffix}`,
          dedupeKey: `sync-a-${suffix}`,
          requestedChannels: ['EMAIL'],
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(Date.now() - 60_000),
        },
        {
          id: syncBId,
          contaId: contaBId,
          asaasCustomerId: `cus-sync-b-${suffix}`,
          dedupeKey: `sync-b-${suffix}`,
          requestedChannels: ['EMAIL'],
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(Date.now() - 60_000),
        },
      ],
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.asaasNotificationPreferenceOutbox.deleteMany({ where: { id: { in: [preferenceAId, preferenceBId] } } });
    await db.asaasNotificationSyncOutbox.deleteMany({ where: { id: { in: [syncAId, syncBId] } } });
    await db.conta.deleteMany({ where: { id: { in: [contaAId, contaBId] } } });
    await db.$disconnect();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditRecord.mockResolvedValue({ id: 'audit-test' });
    mocks.applyPreferences.mockResolvedValue({ updated: true, total: 1 });
    mocks.ensureNotificationsEnabled.mockResolvedValue({ success: true });
    mocks.syncPreferences.mockResolvedValue({
      success: true,
      applied: { email: true, sms: false, whatsapp: false },
      warnings: [],
    });
  });

  it('fences a stale preference worker and keeps the other tenant pending', async () => {
    let signalStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    mocks.applyPreferences.mockImplementationOnce(async () => {
      signalStarted();
      await gate;
      return { updated: true, total: 1 };
    });

    const firstWorker = processPreferenceOutbox!({ contaId: contaAId });
    try {
      await started;
      await database.asaasNotificationPreferenceOutbox.updateMany({
        where: { id: preferenceAId, contaId: contaAId, status: 'PROCESSING' },
        data: { processingAt: new Date(Date.now() - 30 * 60_000) },
      });

      const recoveredWorker = await processPreferenceOutbox!({ contaId: contaAId });
      expect(recoveredWorker).toMatchObject({ processed: 1, failed: 0 });
    } finally {
      releaseFirst();
    }

    const staleWorker = await firstWorker;
    expect(staleWorker).toMatchObject({ processed: 0, failed: 0 });
    const [rowA, rowB] = await Promise.all([
      database.asaasNotificationPreferenceOutbox.findUnique({ where: { id: preferenceAId } }),
      database.asaasNotificationPreferenceOutbox.findUnique({ where: { id: preferenceBId } }),
    ]);
    expect(rowA).toMatchObject({ contaId: contaAId, status: 'DONE', attempts: 2, claimToken: null });
    expect(rowB).toMatchObject({ contaId: contaBId, status: 'PENDING', attempts: 0, claimToken: null });
  }, 30_000);

  it('fences a stale sync worker and keeps the other tenant pending', async () => {
    let signalStarted!: () => void;
    let releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    mocks.syncPreferences.mockImplementationOnce(async () => {
      signalStarted();
      await gate;
      return {
        success: true,
        applied: { email: true, sms: false, whatsapp: false },
        warnings: [],
      };
    });

    const firstWorker = processSyncOutbox!({ contaId: contaAId });
    try {
      await started;
      await database.asaasNotificationSyncOutbox.updateMany({
        where: { id: syncAId, contaId: contaAId, status: 'PROCESSING' },
        data: { processingAt: new Date(Date.now() - 30 * 60_000) },
      });

      const recoveredWorker = await processSyncOutbox!({ contaId: contaAId });
      expect(recoveredWorker).toMatchObject({ processed: 1, failed: 0 });
    } finally {
      releaseFirst();
    }

    const staleWorker = await firstWorker;
    expect(staleWorker).toMatchObject({ processed: 0, failed: 0 });
    const [rowA, rowB] = await Promise.all([
      database.asaasNotificationSyncOutbox.findUnique({ where: { id: syncAId } }),
      database.asaasNotificationSyncOutbox.findUnique({ where: { id: syncBId } }),
    ]);
    expect(rowA).toMatchObject({ contaId: contaAId, status: 'DONE', attempts: 2, claimToken: null });
    expect(rowB).toMatchObject({ contaId: contaBId, status: 'PENDING', attempts: 0, claimToken: null });
  }, 30_000);
});
