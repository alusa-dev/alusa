/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', () => ({
  getAutomaticAnticipationMenuVisibility: vi.fn(),
}));

const { GET } = await import('../route');

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as never) : null);
}

describe('GET /api/financeiro/antecipacoes/visibilidade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna cache hit sem consultar gate em chamadas repetidas', async () => {
    await mockSession({ id: 'u1', contaId: 'c-cache', role: 'FINANCEIRO' });

    const finance = await import('@alusa/finance');
    const gate = await import('@/lib/finance/financial-account-gate');

    vi.mocked(finance.getAutomaticAnticipationMenuVisibility).mockResolvedValueOnce({
      showAutomaticAnticipationItem: false,
      accountPersonType: 'FISICA',
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-alusa-cache')).toBe('MISS');
    expect(await response.json()).toEqual({
      data: {
        showAutomaticAnticipationItem: false,
        accountPersonType: 'FISICA',
      },
    });

    const cachedResponse = await GET();
    expect(cachedResponse.status).toBe(200);
    expect(cachedResponse.headers.get('x-alusa-cache')).toBe('HIT');
    expect(gate.guardFinancialAccountOr412).not.toHaveBeenCalled();
    expect(finance.getAutomaticAnticipationMenuVisibility).toHaveBeenCalledTimes(1);
  });

  it('retorna 401 quando nao autenticado', async () => {
    await mockSession(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });
});