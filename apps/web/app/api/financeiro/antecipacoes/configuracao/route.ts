import { NextRequest } from 'next/server';
import { ZodError } from 'zod';

import {
  getReceivableAnticipationConfiguration,
  updateAnticipationConfigurationInputDTOSchema,
  updateReceivableAnticipationConfiguration,
} from '@alusa/finance';
import { anticipationErrorResponse, json, requireFinanceUser } from '../_shared';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateCacheControl } from '@/lib/private-cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const configurationCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});
const configurationCacheControl = privateCacheControl({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});

export async function GET() {
  const timer = createPerfTimer('api/financeiro/antecipacoes/configuracao');
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const cached = configurationCache.get(auth.user.contaId);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /antecipacoes/configuracao (cache hit)', { cacheState: cached.state });
      return json(200, cached.body, {
        'cache-control': configurationCacheControl,
        'x-alusa-cache': cached.state,
      });
    }

    const result = await withPerfTimer(
      'finance.getReceivableAnticipationConfiguration',
      'call Asaas',
      () => getReceivableAnticipationConfiguration({ contaId: auth.user.contaId })
    );

    if (!result.success) return anticipationErrorResponse(result.error);

    const body = { data: result.data, fetchedAt: new Date().toISOString() };
    configurationCache.set(auth.user.contaId, body);

    timer.end('GET /antecipacoes/configuracao (cache miss)');
    return json(200, body, {
      'cache-control': configurationCacheControl,
      'x-alusa-cache': 'MISS',
    });
  } catch (error) {
    console.error('[API antecipacoes configuracao][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireFinanceUser();
    if (!auth.ok) return auth.response;

    const input = updateAnticipationConfigurationInputDTOSchema.parse(await req.json());
    const result = await updateReceivableAnticipationConfiguration({
      contaId: auth.user.contaId,
      userId: auth.user.id,
      creditCardAutomaticEnabled: input.creditCardAutomaticEnabled,
    });

    if (!result.success) return anticipationErrorResponse(result.error);
    configurationCache.delete(auth.user.contaId);
    return json(200, { data: result.data });
  } catch (error) {
    if (error instanceof ZodError) {
      return json(422, { error: 'BODY_INVALIDO', details: error.flatten() });
    }
    console.error('[API antecipacoes configuracao][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
