import { describe, expect, it } from 'vitest';

import {
  apiJson,
  apiJsonAccepted,
  apiJsonCreated,
  apiJsonError,
  apiJsonNoContent,
} from '@/lib/api/standard-response';
import { publicInvoiceProviderErrorMessage } from '@/lib/api/finance-invoice-errors';

describe('apiJsonError', () => {
  it('does not expose internal messages on 5xx responses', async () => {
    const response = apiJsonError(500, 'ERRO_INTERNO', 'Prisma: SELECT segredo');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'ERRO_INTERNO',
        message: 'Não foi possível concluir a operação agora.',
      },
    });
  });

  it('preserves mapped domain details on 4xx responses', async () => {
    const response = apiJsonError(422, 'ERRO_VALIDACAO', 'Dados inválidos.', { field: 'email' });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toEqual({
      code: 'ERRO_VALIDACAO',
      message: 'Dados inválidos.',
      details: { field: 'email' },
    });
  });
});

describe('success response helpers', () => {
  it('keeps a synchronous success at 200 and adds no-store by default', async () => {
    const response = apiJson({ data: { id: 'aluno-1' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ data: { id: 'aluno-1' } });
  });

  it('uses 201 for a created resource without changing the payload', async () => {
    const response = apiJsonCreated({ data: { id: 'cobranca-1' } });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { id: 'cobranca-1' } });
  });

  it('uses 202 for an accepted asynchronous command and propagates correlation', async () => {
    const response = apiJsonAccepted(
      { data: { operationId: 'op-1' } },
      { correlationId: 'corr-1' },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('x-correlation-id')).toBe('corr-1');
  });

  it('returns an empty 204 response without serializing JSON', async () => {
    const response = apiJsonNoContent();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});

describe('publicInvoiceProviderErrorMessage', () => {
  it('não expõe a mensagem recebida do provedor financeiro', () => {
    expect(
      publicInvoiceProviderErrorMessage(
        { kind: 'ASAAS', status: 422, message: 'token interno e detalhes de autenticação' },
        'emitir',
      ),
    ).toBe('Não foi possível emitir a nota fiscal no provedor financeiro.');
  });
});
