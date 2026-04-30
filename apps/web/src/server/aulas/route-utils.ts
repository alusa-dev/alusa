import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AulasError } from '@/src/server/aulas/aulas-error';

export function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export function handleAulasRouteError(error: unknown, fallbackCode: string) {
  if (error instanceof ZodError) {
    return json(422, { error: 'VALIDACAO_INVALIDA', details: error.flatten() });
  }

  if (error instanceof AulasError) {
    return json(error.statusCode, {
      error: error.code,
      detail: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  return json(500, { error: fallbackCode, detail: (error as Error).message });
}
