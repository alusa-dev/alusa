import { NextResponse } from 'next/server';

type JsonResponseInit = ResponseInit & {
  correlationId?: string;
};

function responseInit(init: JsonResponseInit = {}): ResponseInit {
  const headers = new Headers(init.headers);
  headers.set('cache-control', headers.get('cache-control') ?? 'no-store');
  if (init.correlationId) headers.set('x-correlation-id', init.correlationId);

  const { correlationId: _correlationId, ...responseOptions } = init;
  return { ...responseOptions, headers };
}

/**
 * Resposta JSON de sucesso. Mantém o payload existente e centraliza headers.
 * O envelope `{ data }` só deve ser usado quando fizer parte do contrato da rota;
 * este helper não altera a compatibilidade dos consumidores atuais.
 */
export function apiJson<T>(body: T, init: JsonResponseInit = {}) {
  return NextResponse.json(body, responseInit(init));
}

export function apiJsonCreated<T>(body: T, init: JsonResponseInit = {}) {
  return apiJson(body, { ...init, status: 201 });
}

export function apiJsonAccepted<T>(body: T, init: JsonResponseInit = {}) {
  return apiJson(body, { ...init, status: 202 });
}

export function apiJsonNoContent(init: JsonResponseInit = {}) {
  return new NextResponse(null, { ...responseInit(init), status: 204 });
}

/**
 * Envelope comum para erros HTTP internos da Alusa.
 * Exceções de 5xx nunca são devolvidas ao consumidor: podem conter SQL,
 * identificadores internos ou dados sensíveis de provedores.
 */
export function apiJsonError(status: number, code: string, message: string, details?: unknown) {
  return apiJson(
    {
      error: {
        code,
        message: status >= 500 ? 'Não foi possível concluir a operação agora.' : message,
        ...(status < 500 && details !== undefined ? { details } : {}),
      },
    },
    { status },
  );
}
