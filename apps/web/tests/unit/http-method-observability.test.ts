import { describe, expect, it, vi } from 'vitest';

import {
  getKnownApiMethods,
  isKnownApiMethodAllowed,
  methodNotAllowedResponse,
} from '@/lib/security/http-method-observability';

describe('http method observability', () => {
  it('identifica os métodos efetivos dos jobs e webhooks prioritários', () => {
    expect(getKnownApiMethods('/api/jobs/reconcile-payment-commands')).toEqual(['GET', 'POST']);
    expect(getKnownApiMethods('/api/jobs/archive-finance-webhooks')).toEqual(['GET', 'POST']);
    expect(getKnownApiMethods('/api/webhooks/stripe')).toEqual(['POST']);
    expect(getKnownApiMethods('/api/webhooks/whatsapp')).toEqual(['GET', 'POST']);
    expect(getKnownApiMethods('/api/comunicacao/whatsapp/contratos/contrato-1/template')).toEqual(['GET', 'POST']);
    expect(getKnownApiMethods('/api/comunicacao/whatsapp/contratos/contrato-1')).toEqual(['POST']);
  });

  it('considera HEAD e OPTIONS automáticos quando aplicável', () => {
    const methods = getKnownApiMethods('/api/jobs/reconcile-payment-commands');
    expect(methods).not.toBeNull();
    expect(isKnownApiMethodAllowed('HEAD', methods ?? [])).toBe(true);
    expect(isKnownApiMethodAllowed('OPTIONS', methods ?? [])).toBe(true);
    expect(isKnownApiMethodAllowed('DELETE', methods ?? [])).toBe(false);
  });

  it('retorna 405 sem incluir query string ou payload no log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const request = new Request('https://alusa.app/api/webhooks/stripe?token=secret', {
      method: 'GET',
      headers: {
        origin: 'https://alusa.app',
        referer: 'https://alusa.app/admin?token=secret',
        'user-agent': 'test-agent',
      },
    });

    const response = methodNotAllowedResponse(request, ['POST'], 'route_method_not_declared');

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('OPTIONS, POST');
    const log = warn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(log).toMatchObject({
      route: '/api/webhooks/stripe',
      method: 'GET',
      origin: 'same-origin',
      refererOrigin: 'same-origin',
    });
    expect(log).not.toHaveProperty('token');
    expect(JSON.stringify(log)).not.toContain('secret');
    warn.mockRestore();
  });
});
