import { describe, expect, it, vi } from 'vitest';
import { registerTelemetrySink, type StructuredLog } from '@alusa/observability';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';

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
    expect(getKnownApiMethods('/api/comunicacao/whatsapp/contratos/contrato-1/template')).toEqual([
      'GET',
      'POST',
    ]);
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

  it('permite apenas categoria, tipo de erro e contagens na telemetria operacional', () => {
    const records: StructuredLog[] = [];
    const unsubscribe = registerTelemetrySink({ log: (record) => records.push(record) });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      logApiOperationalEvent({
        severity: 'error',
        eventName: 'api.platform_billing.stripe_webhook.request.failed',
        route: '/api/webhooks/stripe',
        method: 'POST',
        requestId: 'request-12345678',
        error: new Error('secret account and Stripe payload'),
        processedCount: 2,
        failedCount: 1,
        outcome: 'partial_failure',
      });

      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        severity: 'error',
        'event.name': 'api.platform_billing.stripe_webhook.request.failed',
        'http.route': '/api/webhooks/stripe',
        'http.request.method': 'post',
        'error.type': 'Error',
        attributes: { processedCount: 2, failedCount: 1, outcome: 'partial_failure' },
      });
      expect(JSON.stringify(records)).not.toContain('secret account');
      expect(JSON.stringify(records)).not.toContain('Stripe payload');
    } finally {
      unsubscribe();
      errorLog.mockRestore();
    }
  });

  it('sanitiza falhas de assinatura pública e normaliza o caminho com token', () => {
    const records: StructuredLog[] = [];
    const unsubscribe = registerTelemetrySink({ log: (record) => records.push(record) });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      logApiOperationalEvent({
        severity: 'error',
        eventName: 'api.public_contract.sign.failed',
        route: '/api/public/contrato/[token]/assinar',
        method: 'POST',
        requestId: 'request-12345678',
        error: new Error('sensitive token and signer details'),
      });

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        'event.name': 'api.public_contract.sign.failed',
        'http.route': '/api/public/contrato/:id/assinar',
        'http.request.method': 'post',
        'error.type': 'Error',
      });
      expect(JSON.stringify(records)).not.toContain('sensitive token');
      expect(JSON.stringify(records)).not.toContain('signer details');
    } finally {
      unsubscribe();
      errorLog.mockRestore();
    }
  });
});
