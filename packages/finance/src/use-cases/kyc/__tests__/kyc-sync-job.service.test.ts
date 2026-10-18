import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accountFindFirst: vi.fn(),
  jobUpsert: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdateMany: vi.fn(),
  loadCredentials: vi.fn(),
  refresh: vi.fn(),
  auditRecord: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: { findFirst: mocks.accountFindFirst },
    asaasIntegrationJob: {
      upsert: mocks.jobUpsert,
      findMany: mocks.jobFindMany,
      updateMany: mocks.jobUpdateMany,
    },
    auditLog: { create: vi.fn() },
    $transaction: mocks.transaction,
  },
  loadAsaasCredentials: mocks.loadCredentials,
}));
vi.mock('../refresh-kyc-read-model', () => ({ refreshKycReadModel: mocks.refresh }));
vi.mock('../../../foundation/audit-log.service', () => ({
  auditLogService: { record: mocks.auditRecord },
}));

import { enqueueKycReadModelSync, processKycReadModelSyncJobs } from '../kyc-sync-job.service';

const provisionedAtForJob = new Date(Date.now() - 60_000);
const job = {
  id: 'job-1',
  contaId: 'tenant-a',
  type: 'SYNC_KYC_STATUS',
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: new Date(Date.now() - 1000),
  processingAt: null,
  payload: { asaasAccountId: 'account-a' },
  idempotencyKey: `kyc-bootstrap:account-a:${provisionedAtForJob.toISOString()}`,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountFindFirst.mockResolvedValue({ id: 'account-a', asaasAccountId: 'external-a', provisionedAt: provisionedAtForJob });
  mocks.jobUpsert.mockResolvedValue({ id: 'job-1' });
  mocks.jobFindMany.mockResolvedValue([job]);
  mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    asaasIntegrationJob: { updateMany: mocks.jobUpdateMany },
    auditLog: { create: vi.fn() },
  }));
  mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.loadCredentials.mockResolvedValue({ apiKey: 'tenant-key' });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.auditRecord.mockResolvedValue(undefined);
});

describe('KYC read model sync job', () => {
  it('enqueues tenant-scoped idempotent work no earlier than provisionedAt + 15s', async () => {
    const provisionedAt = new Date(Date.now() - 3_000);
    const enqueueStartedAt = Date.now();
    mocks.accountFindFirst.mockResolvedValue({ id: 'account-a', provisionedAt });

    await enqueueKycReadModelSync('tenant-a');

    const create = mocks.jobUpsert.mock.calls[0][0].create;
    expect(mocks.jobUpsert.mock.calls[0][0].where.uq_asaas_integration_job.contaId).toBe('tenant-a');
    expect(create.type).toBe('SYNC_KYC_STATUS');
    expect(create.idempotencyKey).toBe(`kyc-bootstrap:account-a:${provisionedAt.toISOString()}`);
    expect(create.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(provisionedAt.getTime() + 15_000);
    expect(create.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(enqueueStartedAt + 15_000);
  });

  it('uses the same idempotency key on repeated enqueue and preserves the existing schedule', async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    await enqueueKycReadModelSync('tenant-a');
    await enqueueKycReadModelSync('tenant-a');

    expect(mocks.jobUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.jobUpsert.mock.calls[0][0].where).toEqual(mocks.jobUpsert.mock.calls[1][0].where);
    expect(mocks.jobUpsert.mock.calls[1][0].update).toEqual({});
  });

  it('requeues only the exhausted FAILED job for the current generation via CAS and records audit', async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });

    await enqueueKycReadModelSync('tenant-a');

    expect(mocks.jobUpdateMany.mock.calls[0][0].where).toMatchObject({
      contaId: 'tenant-a',
      type: 'SYNC_KYC_STATUS',
      idempotencyKey: `kyc-bootstrap:account-a:${provisionedAtForJob.toISOString()}`,
      status: 'FAILED',
      attempts: { gte: 8 },
    });
    expect(mocks.jobUpdateMany.mock.calls[0][0].data).toMatchObject({
      status: 'PENDING', attempts: 0, processingAt: null, doneAt: null,
    });
    expect(mocks.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a',
      action: 'finance.kyc.bootstrap_job.requeued',
      actor: { type: 'SYSTEM' },
    }), expect.objectContaining({ auditLog: expect.any(Object) }));
  });

  it('leaves a healthy or running job untouched when terminal-failure CAS does not match', async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });

    await enqueueKycReadModelSync('tenant-a');

    expect(mocks.jobUpdateMany.mock.calls[0][0].where.status).toBe('FAILED');
    expect(mocks.auditRecord).not.toHaveBeenCalled();
  });

  it('does not keep the replay when audit persistence fails inside the transaction', async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditRecord.mockRejectedValue(new Error('audit unavailable'));

    await expect(enqueueKycReadModelSync('tenant-a')).rejects.toThrow('audit unavailable');

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.auditRecord).toHaveBeenCalledOnce();
    expect(mocks.auditRecord.mock.calls[0][1]).toEqual(expect.objectContaining({ auditLog: expect.any(Object) }));
  });

  it('reopens bootstrap for a new generation after an earlier job is terminal', async () => {
    const firstProvision = new Date('2026-10-18T00:00:00.000Z');
    const secondProvision = new Date('2026-10-18T01:00:00.000Z');
    await enqueueKycReadModelSyncForTest(firstProvision);
    await enqueueKycReadModelSyncForTest(secondProvision);

    const firstKey = mocks.jobUpsert.mock.calls[0][0].create.idempotencyKey;
    const secondKey = mocks.jobUpsert.mock.calls[1][0].create.idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
    expect(mocks.jobUpsert.mock.calls[1][0].create.status).toBe('PENDING');
  });

  it('processes only due jobs for the requested tenant and refreshes using that tenant', async () => {
    await processKycReadModelSyncJobs({ contaId: 'tenant-a' });

    expect(mocks.jobFindMany.mock.calls[0][0].where.contaId).toBe('tenant-a');
    expect(mocks.refresh).toHaveBeenCalledWith('tenant-a');
    expect(mocks.jobUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.jobUpdateMany.mock.calls[1][0]).toMatchObject({
      where: { id: 'job-1', status: 'PROCESSING', processingAt: expect.any(Date) },
      data: { status: 'DONE', processingAt: null },
    });
  });

  it('backs off on provider/configuration failures and stops selecting exhausted jobs', async () => {
    mocks.loadCredentials.mockResolvedValue(null);

    const result = await processKycReadModelSyncJobs();

    expect(result.failed).toBe(1);
    const failure = mocks.jobUpdateMany.mock.calls[1][0].data;
    expect(failure.status).toBe('FAILED');
    expect(failure.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(failure.lastError).toMatch(/Credenciais Asaas ausentes/);
    expect(mocks.jobFindMany.mock.calls[0][0].where.OR[1].attempts).toEqual({ lt: 8 });
    expect(mocks.jobUpdateMany.mock.calls[0][0].data.attempts).toEqual({ increment: 1 });
  });

  it('does not execute the same job when another worker already claimed it', async () => {
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });

    const result = await processKycReadModelSyncJobs();

    expect(result.processed).toBe(0);
    expect(mocks.loadCredentials).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('reclaims stale processing work with a fenced new claim and incremented attempt', async () => {
    const processingAt = new Date(Date.now() - 10 * 60_000);
    mocks.jobFindMany.mockResolvedValue([{ ...job, status: 'PROCESSING', attempts: 2, processingAt }]);

    const result = await processKycReadModelSyncJobs();

    expect(result.processed).toBe(1);
    expect(mocks.jobUpdateMany.mock.calls[0][0].where).toMatchObject({
      status: 'PROCESSING',
      processingAt,
      attempts: 2,
    });
    expect(mocks.jobUpdateMany.mock.calls[0][0].data.attempts).toEqual({ increment: 1 });
    expect(mocks.jobUpdateMany.mock.calls[1][0].where.processingAt).toEqual(
      mocks.jobUpdateMany.mock.calls[0][0].data.processingAt,
    );
  });

  it('makes a stale worker unable to finalize after another worker reclaimed the lease', async () => {
    const oldClaimAt = new Date(Date.now() - 10 * 60_000);
    mocks.jobFindMany.mockResolvedValue([{ ...job, status: 'PROCESSING', attempts: 2, processingAt: oldClaimAt }]);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const result = await processKycReadModelSyncJobs();

    expect(result.lostClaims).toBe(1);
    expect(result.processed).toBe(0);
    expect(mocks.jobUpdateMany.mock.calls[0][0].where.processingAt).toEqual(oldClaimAt);
    expect(mocks.jobUpdateMany.mock.calls[1][0].where.processingAt).not.toEqual(oldClaimAt);
  });

  it('does not let an old failing worker overwrite a newer lease', async () => {
    const oldClaimAt = new Date(Date.now() - 10 * 60_000);
    mocks.jobFindMany.mockResolvedValue([{ ...job, status: 'PROCESSING', attempts: 2, processingAt: oldClaimAt }]);
    mocks.loadCredentials.mockResolvedValue(null);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const result = await processKycReadModelSyncJobs();

    expect(result.lostClaims).toBe(1);
    expect(result.failed).toBe(0);
    expect(mocks.jobUpdateMany.mock.calls[1][0].where).toMatchObject({
      id: 'job-1',
      status: 'PROCESSING',
      processingAt: mocks.jobUpdateMany.mock.calls[0][0].data.processingAt,
    });
  });

  it('terminalizes a stale job that exhausted its attempts without another provider call', async () => {
    const processingAt = new Date(Date.now() - 10 * 60_000);
    mocks.jobFindMany.mockResolvedValue([{ ...job, status: 'PROCESSING', attempts: 8, processingAt }]);

    const result = await processKycReadModelSyncJobs();

    expect(result.failed).toBe(1);
    expect(mocks.jobUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.jobUpdateMany.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', processingAt: null });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('skips provider reads when webhook already produced a read model after provisioning', async () => {
    const provisionedAt = new Date(Date.now() - 30_000);
    mocks.jobFindMany.mockResolvedValue([{
      ...job,
      idempotencyKey: `kyc-bootstrap:account-a:${provisionedAt.toISOString()}`,
    }]);
    mocks.accountFindFirst.mockResolvedValue({
      id: 'account-a',
      asaasAccountId: 'external-a',
      provisionedAt,
      documentsCache: { version: 2, groups: [], myAccountStatus: null, rejectReasons: [], fetchedAt: new Date().toISOString() },
      documentsCacheUpdatedAt: new Date(),
    });

    const result = await processKycReadModelSyncJobs();

    expect(result.skippedFresh).toBe(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

async function enqueueKycReadModelSyncForTest(provisionedAt: Date) {
  mocks.accountFindFirst.mockResolvedValue({
    id: 'account-a', provisionedAt, documentsCache: null, documentsCacheUpdatedAt: null,
  });
  const { enqueueKycReadModelSyncForAccount } = await import('../kyc-sync-job.service');
  await enqueueKycReadModelSyncForAccount({ asaasIntegrationJob: { upsert: mocks.jobUpsert } } as never, {
    contaId: 'tenant-a', asaasAccountId: 'account-a', provisionedAt,
  });
}
