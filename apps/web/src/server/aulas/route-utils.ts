import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AulasError } from '@/src/server/aulas/aulas-error';

const SERVER_TIMING_SAFE = /^[a-z0-9_-]+$/i;

function roundTimingMs(ms: number) {
  return Math.round(ms * 1000) / 1000;
}

/** Formato W3C Server-Timing para observabilidade (dev/prod-safe). */
export function buildAgendaServerTimingHeader(timings: Record<string, number | undefined>) {
  const parts: string[] = [];

  Object.entries(timings).forEach(([rawName, dur]) => {
    if (typeof dur !== 'number' || Number.isNaN(dur) || dur < 0) return;
    const name = SERVER_TIMING_SAFE.test(rawName) ? rawName : rawName.replace(/[^a-z0-9_-]/gi, '_');
    parts.push(`${name};dur=${roundTimingMs(dur)}`);
  });

  return parts.join(', ');
}

export function json(status: number, body: unknown, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...(extraHeaders ?? {}) },
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
