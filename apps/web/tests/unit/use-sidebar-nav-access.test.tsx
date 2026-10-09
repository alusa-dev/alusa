import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a', contaId: 'conta-a', role: 'ADMIN', financeIntegrationMode: 'ASAAS' },
  fetch: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: mocks.user } }),
}));
vi.mock('@/features/kyc/KycEnforcementProvider', () => ({
  useKycEnforcement: () => ({ verification: null, loading: false, isApproved: true }),
}));

import { useSidebarNavAccess } from '@/components/layout/use-sidebar-nav-access';

describe('useSidebarNavAccess', () => {
  beforeEach(() => {
    mocks.user.contaId = 'conta-a';
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { showAutomaticAnticipationItem: true } }),
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refetches tenant visibility when the active account changes with the same role', async () => {
    const { rerender } = renderHook(() => useSidebarNavAccess());

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));

    mocks.user.contaId = 'conta-b';
    rerender();

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, '/api/financeiro/antecipacoes/visibilidade', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
  });
});
