import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSessionMock, drainMock, applyPlanChangesMock, applyGracePeriodsMock, maintenanceMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  drainMock: vi.fn(),
  applyPlanChangesMock: vi.fn(),
  applyGracePeriodsMock: vi.fn(),
  maintenanceMock: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/src/server/platform-billing/webhook-worker', () => ({ drainStripeWebhookWorker: drainMock }));
vi.mock('@/src/server/platform-billing/http-commands', () => ({ applyDuePlatformPlanChangesFromHttp: applyPlanChangesMock }));
vi.mock('@/src/server/platform-billing/grace-period-jobs', () => ({ expirePlatformBillingGracePeriods: applyGracePeriodsMock }));
vi.mock('@/src/server/platform-billing/http-commands', () => ({
  applyDuePlatformPlanChangesFromHttp: applyPlanChangesMock,
  runPlatformBillingMaintenanceFromHttp: maintenanceMock,
}));

import { POST as drainWebhooks } from '@/app/api/admin/platform-billing/webhooks/drain/route';
import { POST as applyPlanChanges } from '@/app/api/admin/platform-billing/plan-changes/apply/route';
import { POST as applyGracePeriods } from '@/app/api/admin/platform-billing/grace-periods/apply/route';
import { POST as runMaintenance } from '@/app/api/admin/platform-billing/maintenance/route';

const handlers = [drainWebhooks, applyPlanChanges, applyGracePeriods, runMaintenance];

function request(secret?: string) {
  return new NextRequest('http://alusa.test/api/admin/platform-billing/worker', {
    method: 'POST',
    headers: secret ? { 'x-platform-billing-worker-secret': secret } : undefined,
    body: JSON.stringify({ limit: 3 }),
  });
}

describe('global platform billing worker authorization', () => {
  const originalSecret = process.env.PLATFORM_BILLING_WORKER_SECRET;

  beforeEach(() => {
    delete process.env.PLATFORM_BILLING_WORKER_SECRET;
    vi.clearAllMocks();
    drainMock.mockResolvedValue({ claimed: 0 });
    applyPlanChangesMock.mockResolvedValue({ applied: 0 });
    applyGracePeriodsMock.mockResolvedValue({ expired: 0 });
    maintenanceMock.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.PLATFORM_BILLING_WORKER_SECRET;
    else process.env.PLATFORM_BILLING_WORKER_SECRET = originalSecret;
  });

  it.each(handlers.map((handler, index) => [
    ['webhook drain', 'plan-change apply', 'grace-period apply', 'maintenance'][index], handler,
  ] as const))('%s rejects tenant ADMIN fallback and permits SUPER_ADMIN fallback', async (_name, handler) => {
    getServerSessionMock.mockResolvedValue({ user: { role: 'ADMIN' } });
    const denied = await handler(request());
    expect(denied.status).toBe(403);

    getServerSessionMock.mockResolvedValue({ user: { role: 'SUPER_ADMIN' } });
    const allowed = await handler(request());
    expect(allowed.status).toBe(200);
  });

  it.each(handlers.map((handler, index) => [
    ['webhook drain', 'plan-change apply', 'grace-period apply', 'maintenance'][index], handler,
  ] as const))('%s requires the configured worker secret even for SUPER_ADMIN', async (_name, handler) => {
    process.env.PLATFORM_BILLING_WORKER_SECRET = 'worker-secret';
    getServerSessionMock.mockResolvedValue({ user: { role: 'SUPER_ADMIN' } });

    expect((await handler(request())).status).toBe(403);
    expect((await handler(request('worker-secret'))).status).toBe(200);
  });
});
