/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  expireGracePeriods: vi.fn(),
  expireTrials: vi.fn(),
  reconcile: vi.fn(),
  drainWebhooks: vi.fn(),
  applyPlanChanges: vi.fn(),
  captureMonthlySnapshots: vi.fn(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResult: vi.fn(),
  logJobFailure: vi.fn(),
  recordJobRequestRejected: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/src/server/platform-billing/grace-period-jobs', () => ({ expirePlatformBillingGracePeriods: mocks.expireGracePeriods }));
vi.mock('@/src/server/platform-billing/trial-jobs', () => ({ expirePlatformBillingTrials: mocks.expireTrials }));
vi.mock('@/src/server/platform-billing/reconciliation', () => ({ reconcilePlatformBilling: mocks.reconcile }));
vi.mock('@/src/server/platform-billing/webhook-worker', () => ({ drainStripeWebhookWorker: mocks.drainWebhooks }));
vi.mock('@/src/server/platform-billing/plan-change-actions', () => ({ applyDuePlatformPlanChanges: mocks.applyPlanChanges }));
vi.mock('@/src/server/platform-billing/monthly-snapshots', () => ({ capturePlatformBillingMonthlySnapshots: mocks.captureMonthlySnapshots }));
vi.mock('@/src/server/jobs/job-observability', () => ({ startJobRun: mocks.startJobRun, logJobResult: mocks.logJobResult, logJobFailure: mocks.logJobFailure, recordJobRequestRejected: mocks.recordJobRequestRejected }));

import { GET } from '../route';

describe('GET /api/jobs/platform-billing-maintenance telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'canonical-secret');
    vi.stubEnv('CRON_SECRET_TOKEN', 'cron-secret');
    mocks.drainWebhooks.mockResolvedValue({ processed: 0, failed: 0, exhausted: 0, notifications: { claimed: 0, delivered: 0, failed: 0, exhausted: 0 } });
    mocks.applyPlanChanges.mockResolvedValue({ checked: 0, submitted: 0, failed: 0 });
    mocks.expireTrials.mockResolvedValue({ checked: 0, detected: 0, notificationQueued: 0 });
    mocks.expireGracePeriods.mockResolvedValue({ checked: 0, restricted: 0, notified: 0 });
    mocks.reconcile.mockResolvedValue({ checkedAccounts: 0, issues: 0 });
    mocks.captureMonthlySnapshots.mockResolvedValue({ checked: 0, captured: 0, readyForSpecialist: 0, transitionsScheduled: 0, specialistNoticesCreated: 0 });
  });

  it('counts reconciled billing issues as useful work', async () => {
    mocks.reconcile.mockResolvedValue({ checkedAccounts: 1, issues: 1 });

    const response = await GET(new Request('http://localhost/api/jobs/platform-billing-maintenance', {
      headers: { 'x-cron-token': 'cron-secret' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'platform-billing-maintenance',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({ billingIssues: 1 }),
      expect.objectContaining({ workStatus: 'worked' }),
    );
  });

  it('counts monthly snapshot capture as useful work when it is the only work performed', async () => {
    mocks.captureMonthlySnapshots.mockResolvedValue({
      checked: 1,
      captured: 1,
      readyForSpecialist: 0,
      transitionsScheduled: 0,
      specialistNoticesCreated: 0,
    });

    const response = await GET(new Request('http://localhost/api/jobs/platform-billing-maintenance', {
      headers: { 'x-cron-token': 'cron-secret' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'platform-billing-maintenance',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({ pricingSnapshotsCaptured: 1 }),
      expect.objectContaining({ workStatus: 'worked' }),
    );
  });

  it('records invalid cron credentials as a rejected request without starting a job', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/platform-billing-maintenance', {
      headers: { 'x-cron-token': 'wrong-secret' },
    }));

    expect(response.status).toBe(401);
    expect(mocks.recordJobRequestRejected).toHaveBeenCalledWith('platform-billing-maintenance', 401);
    expect(mocks.startJobRun).not.toHaveBeenCalled();
    expect(mocks.logJobResult).not.toHaveBeenCalled();
    expect(mocks.logJobFailure).not.toHaveBeenCalled();
    expect(mocks.drainWebhooks).not.toHaveBeenCalled();
  });

  it('accepts canonical Bearer auth when the legacy secret conflicts', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/platform-billing-maintenance', {
      headers: { authorization: 'Bearer canonical-secret' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordJobRequestRejected).not.toHaveBeenCalled();
    expect(mocks.startJobRun).toHaveBeenCalledTimes(1);
    expect(mocks.drainWebhooks).toHaveBeenCalledTimes(1);
  });
});
