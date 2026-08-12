import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getExternalPixKey } from './getExternalPixKey';

describe('getExternalPixKey', () => {
  beforeEach(() => {
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({
        type: 'PHONE',
        key: '+5547996515839',
        owner: { name: 'João Silva', cpfCnpj: '***.202.745-**' },
      }),
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('consulta a chave com type e key na query string', async () => {
    const response = await getExternalPixKey({
      apiKey: 'sandbox-key',
      type: 'PHONE',
      key: '47996515839',
    });

    expect(response.owner?.name).toBe('João Silva');
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api-sandbox.asaas.com/v3/pix/addressKeys/external?type=PHONE&key=47996515839');
    expect(init).toMatchObject({ method: 'GET' });
    expect((init?.headers as Record<string, string>).access_token).toBe('sandbox-key');
  });
});
