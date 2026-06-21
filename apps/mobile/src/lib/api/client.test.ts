import { createApiClient } from './client';
import { ApiError } from './errors';

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    ...init,
    headers: {
      ...(body == null ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
}

describe('createApiClient', () => {
  it('retorna JSON de sucesso', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ ok: true }));
    const api = createApiClient({ baseUrl: 'https://api.alusa.test', fetchImpl });

    await expect(api.request({ path: '/health' })).resolves.toEqual({ ok: true });
  });

  it('retorna undefined para 204', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(null, { status: 204 }));
    const api = createApiClient({ baseUrl: 'https://api.alusa.test', fetchImpl });

    await expect(api.request({ path: '/logout' })).resolves.toBeUndefined();
  });

  it.each([
    [400, 'VALIDATION_ERROR'],
    [401, 'UNAUTHORIZED'],
    [500, 'SERVER_ERROR'],
  ] as const)('normaliza status %s', async (status, code) => {
    const fetchImpl = jest.fn().mockResolvedValue(
      response({ error: { message: 'Falhou' } }, { status }),
    );
    const api = createApiClient({ baseUrl: 'https://api.alusa.test', fetchImpl });

    await expect(api.request({ path: '/x' })).rejects.toMatchObject({ code });
  });

  it('identifica erro de rede', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
    const api = createApiClient({ baseUrl: 'https://api.alusa.test', fetchImpl });

    await expect(api.request({ path: '/x' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('envia header de autenticação', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ ok: true }));
    const api = createApiClient({ baseUrl: 'https://api.alusa.test', fetchImpl });

    await api.request({ path: '/me', accessToken: 'token_123' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.alusa.test/me',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token_123' }),
      }),
    );
  });

  it('dispara callback ao receber 401', async () => {
    const onUnauthorized = jest.fn();
    const fetchImpl = jest.fn().mockResolvedValue(response({}, { status: 401 }));
    const api = createApiClient({ baseUrl: 'https://api.alusa.test', fetchImpl, onUnauthorized });

    await expect(api.request({ path: '/me' })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
