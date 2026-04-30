import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchExtrato } from '@/features/financeiro/extrato/services/get-extrato';

describe('fetchExtrato', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('usa fixture local em desenvolvimento quando debugFixture=sample-ledger', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    window.history.replaceState({}, '', '/financeiro/extrato?debugFixture=sample-ledger');

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await fetchExtrato({
      page: 1,
      pageSize: 20,
      sort: 'date',
      direction: 'desc',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(result.summary.receitas).toBeGreaterThan(0);
    expect(result.transactions.some((entry) => entry.type === 'RECEITA')).toBe(true);
    expect(result.transactions.some((entry) => entry.type === 'TAXA')).toBe(true);
  });

  it('repassa signal para o fetch do BFF', async () => {
    const signal = new AbortController().signal;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
          filters: {},
          transactions: [],
          pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1, hasNextPage: false },
          sync: {
            provider: 'ASAAS',
            fetchedAt: new Date().toISOString(),
            officialTotalCount: 0,
            fetchedCount: 0,
            truncated: false,
            maxWindowPages: 50,
          },
        }),
      ),
    );

    await fetchExtrato(
      {
        page: 1,
        pageSize: 20,
        sort: 'date',
        direction: 'desc',
      },
      { signal },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/financeiro/extrato?page=1&pageSize=20&sort=date&direction=desc',
      expect.objectContaining({ signal }),
    );
  });
});