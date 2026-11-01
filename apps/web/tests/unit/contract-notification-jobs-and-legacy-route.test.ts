import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveScope: vi.fn(), resolveTenantScopeForJob: vi.fn(), startJobRun: vi.fn(() => ({ startedAt: 1, correlationId: 'test' })),
  logJobResult: vi.fn(), logJobFailure: vi.fn(), drainEmail: vi.fn(), selectTenants: vi.fn(),
  resolveSession: vi.fn(), requeue: vi.fn(), drainWa: vi.fn(), drainOutbox: vi.fn(), getJobId: vi.fn(), getView: vi.fn(),
}));

vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.resolveScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: mocks.resolveTenantScopeForJob, startJobRun: mocks.startJobRun,
  logJobResult: mocks.logJobResult, logJobFailure: mocks.logJobFailure,
}));
vi.mock('@/src/server/contracts/contract-email-notification.service', () => ({
  drainContractEmailNotifications: mocks.drainEmail, selectContractNotificationTenantIdsForRun: mocks.selectTenants,
}));
vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.resolveSession }));
vi.mock('@/src/server/whatsapp/outbox.service', () => ({
  requeueContractWhatsAppNotification: mocks.requeue, drainContractWhatsAppNotifications: mocks.drainWa, drainWhatsAppOutbox: mocks.drainOutbox,
}));
vi.mock('@/src/server/whatsapp/whatsapp-resource.service', () => ({ getContractWhatsAppJobId: mocks.getJobId, getContractWhatsAppNotificationView: mocks.getView }));

import { GET as runEmailJob } from '@/app/api/jobs/process-contract-email-notifications/route';
import { POST as legacyWhatsAppResend } from '@/app/api/comunicacao/whatsapp/contratos/[id]/template/route';

describe('contract notification final gate regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectTenants.mockReset();
    mocks.drainEmail.mockReset();
    mocks.resolveScope.mockResolvedValue({ ok: true, isCron: true, contaId: undefined });
    mocks.resolveTenantScopeForJob.mockImplementation(async (_name: string, resolve: () => Promise<unknown>) => resolve());
    mocks.drainEmail.mockResolvedValue({ claimed: 0, accepted: 0, skipped: 0, retried: 0, deadLettered: 0 });
    mocks.resolveSession.mockResolvedValue({ ok: true, role: 'ADMIN', contaId: 'school-a', userId: 'staff-1' });
    mocks.requeue.mockResolvedValue({ id: 'notification-1' });
    mocks.drainWa.mockResolvedValue({ claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 });
    mocks.getJobId.mockResolvedValue(null);
    mocks.drainOutbox.mockResolvedValue({ claimed: 0, sent: 0, retried: 0, deadLettered: 0 });
  });

  it('successive bounded cron invocations rotate beyond the per-run tenant cap', async () => {
    mocks.selectTenants.mockResolvedValueOnce([{ id: 'school-a' }, { id: 'school-b' }])
      .mockResolvedValueOnce([{ id: 'school-c' }, { id: 'school-d' }]);
    const invoke = () => runEmailJob(new Request('https://alusa.app/api/jobs/process-contract-email-notifications?limit=2', { headers: { authorization: 'Bearer cron' } }));
    expect((await invoke()).status).toBe(200);
    expect((await invoke()).status).toBe(200);
    expect(mocks.selectTenants).toHaveBeenNthCalledWith(1, { limit: 2 });
    expect(mocks.selectTenants).toHaveBeenNthCalledWith(2, { limit: 2 });
    expect(mocks.drainEmail.mock.calls.map(([input]) => input)).toEqual([
      { contaId: 'school-a', limit: 1 }, { contaId: 'school-b', limit: 1 },
      { contaId: 'school-c', limit: 1 }, { contaId: 'school-d', limit: 1 },
    ]);
  });

  it('continues to other tenants when one tenant drain fails', async () => {
    mocks.selectTenants.mockResolvedValueOnce([{ id: 'school-a' }, { id: 'school-b' }]);
    mocks.drainEmail.mockRejectedValueOnce(new Error('tenant failure')).mockResolvedValueOnce({ claimed: 0, accepted: 0, skipped: 0, retried: 0, deadLettered: 0 });
    const response = await runEmailJob(new Request('https://alusa.app/api/jobs/process-contract-email-notifications?limit=2', { headers: { authorization: 'Bearer cron' } }));
    expect(response.status).toBe(503);
    expect(mocks.drainEmail).toHaveBeenNthCalledWith(2, { contaId: 'school-b', limit: 1 });
    expect(await response.json()).toMatchObject({ job: { failedTenants: 1 } });
    expect(mocks.logJobFailure).toHaveBeenCalledWith(
      'process-contract-email-notifications', expect.anything(), expect.any(Error),
      { contaId: 'school-a', errorCode: 'TENANT_DRAIN_FAILED' },
    );
  });

  it('legacy POST rejects missing operationId before queueing and propagates a valid one', async () => {
    const params = { params: Promise.resolve({ id: 'contract-1' }) };
    const missing = await legacyWhatsAppResend(new Request('https://alusa.app/api/comunicacao/whatsapp/contratos/contract-1/template', { method: 'POST', body: '{}' }), params);
    expect(missing.status).toBe(422);
    expect(mocks.requeue).not.toHaveBeenCalled();

    const operationId = 'd9478888-b13c-4c81-a7b1-bbb3a2f8d805';
    const valid = await legacyWhatsAppResend(new Request('https://alusa.app/api/comunicacao/whatsapp/contratos/contract-1/template', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId }),
    }), params);
    expect(valid.status).toBe(200);
    expect(mocks.requeue).toHaveBeenCalledWith({ contaId: 'school-a', contratoId: 'contract-1', actorUserId: 'staff-1', operationId });
  });
});
