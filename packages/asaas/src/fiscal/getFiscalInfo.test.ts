import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsaasHttpError } from '../client/AsaasHttp';
import { globalAsaasHooks } from '../client/asaas-hooks';
import { getFiscalInfo } from './getFiscalInfo';

process.env.ASAAS_BASE_URL = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';

describe('getFiscalInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trata 404 como conta ainda não configurada, sem registrar falha da API', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hookSpy = vi.spyOn(globalAsaasHooks, 'emitApiCall');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: () => 'application/json',
        },
        text: vi.fn().mockResolvedValue(''),
      }),
    );

    await expect(getFiscalInfo({ apiKey: 'sandbox-key' })).rejects.toMatchObject<Partial<AsaasHttpError>>({
      name: 'AsaasHttpError',
      status: 404,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(hookSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/v3/fiscalInfo/',
        httpStatus: 404,
        success: true,
      }),
    );
  });
});
