import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  hasRenewalPermission: vi.fn(),
  platformBillingAccessResponseForConta: vi.fn(),
  createRenewalCampaignFromHttp: vi.fn(),
  listRenewalManagementFromHttp: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/src/server/enrollments/renewal-permissions.service', () => ({ hasRenewalPermission: mocks.hasRenewalPermission }));
vi.mock('@/src/server/platform-billing/capacity', () => ({ platformBillingAccessResponseForConta: mocks.platformBillingAccessResponseForConta }));
vi.mock('@/src/server/enrollments/renewal-http-commands.service', () => ({
  createRenewalCampaignFromHttp: mocks.createRenewalCampaignFromHttp,
  listRenewalManagementFromHttp: mocks.listRenewalManagementFromHttp,
}));

import { POST } from '../route';

describe('POST /api/rematriculas/campanhas platform billing access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: 'user-a', contaId: 'conta-a', role: 'ADMIN' });
    mocks.hasRenewalPermission.mockReturnValue(true);
    mocks.platformBillingAccessResponseForConta.mockResolvedValue({
      status: 402,
      body: { error: 'PLATFORM_BILLING_ACCESS_RESTRICTED' },
    });
  });

  it('blocks campaign creation for a restricted tenant before writing', async () => {
    const response = await POST(new Request('http://alusa.test/api/rematriculas/campanhas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Rematrícula 2027',
        targetPeriodId: 'period-a',
        campaignStartsAt: '2026-11-01',
      }),
    }));

    expect(response?.status).toBe(402);
    expect(mocks.platformBillingAccessResponseForConta).toHaveBeenCalledWith({
      contaId: 'conta-a',
      capability: 'ENROLLMENT_WRITE',
    });
    expect(mocks.createRenewalCampaignFromHttp).not.toHaveBeenCalled();
  });
});
