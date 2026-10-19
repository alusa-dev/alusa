/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  maintenance: vi.fn(),
  logJobResult: vi.fn(),
  logJobFailure: vi.fn(),
  logApi: vi.fn(),
  requestId: vi.fn(),
}));

vi.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }));
vi.mock('@alusa/finance', () => ({ runWebhookHealthAndDriftMaintenance: mocks.maintenance }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResult: mocks.logJobResult,
  logJobFailure: mocks.logJobFailure,
}));
vi.mock('@/lib/observability/api-logger', () => ({
  getRequestId: mocks.requestId,
  logApiOperationalEvent: mocks.logApi,
}));

import { GET } from '../route';

describe('webhook-maintenance failure telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, contaId: 'conta-a', isCron: true });
    mocks.requestId.mockReturnValue('request-1');
  });

  it('preserves API failure logging and records a started job failure without exposing details', async () => {
    const failure = new Error('provider private detail');
    mocks.maintenance.mockRejectedValue(failure);
    const response = await GET(new Request('http://localhost/api/jobs/webhook-maintenance'));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('provider private detail');
    expect(mocks.logApi).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'api.webhook.maintenance.failed',
      route: '/api/jobs/webhook-maintenance',
      error: failure,
    }));
    expect(mocks.logJobFailure).toHaveBeenCalledWith(
      'webhook-maintenance',
      expect.objectContaining({ correlationId: 'test-run-id' }),
      failure,
    );
    expect(mocks.logJobResult).not.toHaveBeenCalled();
  });

  it('registra drift sem suporte como trabalho visível sem falha operacional', async () => {
    mocks.maintenance.mockResolvedValue({
      accountsChecked: 1,
      driftsFound: 1,
      driftsRepaired: 0,
      unsupportedDrifts: 1,
      errors: [],
      health: {
        checkedAccounts: 1,
        interruptedFound: 0,
        recoveredSuccessfully: 0,
        recoveryFailed: 0,
        errors: [],
      },
    });

    const response = await GET(new Request('http://localhost/api/jobs/webhook-maintenance'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.unsupportedDrifts).toBe(1);
    expect(mocks.logJobResult).toHaveBeenCalledWith(
      'webhook-maintenance',
      expect.objectContaining({ correlationId: 'test-run-id' }),
      expect.objectContaining({ unsupportedDrifts: 1 }),
      expect.objectContaining({ partialFailure: false, workStatus: 'worked' }),
    );
  });
});
