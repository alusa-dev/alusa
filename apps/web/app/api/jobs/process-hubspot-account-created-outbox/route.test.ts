import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ hasCronSecret: vi.fn(), drain: vi.fn(), rejected: vi.fn(), start: vi.fn(), failure: vi.fn(), result: vi.fn() }));

vi.mock('@/lib/security/route-protection-registry', () => ({ hasCronSecret: mocks.hasCronSecret }));
vi.mock('@/src/server/public/hubspot-account-created', () => ({ drainHubSpotAccountCreatedOutbox: mocks.drain }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  recordJobRequestRejected: mocks.rejected,
  startJobRun: mocks.start,
  logJobFailure: mocks.failure,
  logJobResult: mocks.result,
}));

describe('HubSpot account-created outbox cron', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('rejects callers without the cron secret before draining records', async () => {
    mocks.hasCronSecret.mockReturnValue(false);
    const { GET } = await import('./route');

    const response = await GET(new Request('http://localhost/api/jobs/process-hubspot-account-created-outbox'));

    expect(response.status).toBe(401);
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.rejected).toHaveBeenCalledWith('process-hubspot-account-created-outbox', 401);
  });
});
