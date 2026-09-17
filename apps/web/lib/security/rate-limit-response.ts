import { NextResponse } from 'next/server';

import type { RateLimitResult } from '@/lib/rate-limit';

function secondsUntil(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

export function rateLimitResponse(
  result: RateLimitResult,
  limit: number,
  message = 'Muitas requisições. Tente novamente mais tarde.',
): NextResponse {
  if (result.source === 'unavailable') {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITER_UNAVAILABLE',
          message: 'Não foi possível validar a disponibilidade da API agora. Tente novamente.',
        },
      },
      { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '5' } },
    );
  }

  const retryAfter = secondsUntil(result.resetAt);
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message,
      },
    },
    {
      status: 429,
      headers: {
        'cache-control': 'no-store',
        'ratelimit-limit': String(limit),
        'ratelimit-remaining': String(Math.max(0, result.remaining)),
        'ratelimit-reset': String(retryAfter),
        'retry-after': String(retryAfter),
      },
    },
  );
}
