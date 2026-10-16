import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestCobrancaAsaasSync } from '@/lib/finance/charge-sync-client';

describe('requestCobrancaAsaasSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('coalesce chamadas concorrentes para a mesma cobrança', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    const first = requestCobrancaAsaasSync('charge-concurrent-a', { throttleMs: 0 });
    const second = requestCobrancaAsaasSync('charge-concurrent-a', { throttleMs: 0 });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cobrancas/charge-concurrent-a/sync-asaas',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-alusa-sync-source': 'explicit_action' }),
      }),
    );
  });

  it('sinaliza a origem de fallback com valor fixo no header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    await requestCobrancaAsaasSync('charge-auto-a', {
      throttleMs: 0,
      source: 'automatic_fallback',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cobrancas/charge-auto-a/sync-asaas',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-alusa-sync-source': 'automatic_fallback' }),
      }),
    );
  });

  it('respeita throttle depois de uma tentativa concluída', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(requestCobrancaAsaasSync('charge-throttled-a', { throttleMs: 60_000 })).resolves.toBe(true);
    await expect(requestCobrancaAsaasSync('charge-throttled-a', { throttleMs: 60_000 })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
