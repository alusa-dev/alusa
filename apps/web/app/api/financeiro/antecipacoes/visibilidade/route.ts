import { getAutomaticAnticipationMenuVisibility } from '@alusa/finance';

import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateCacheControl } from '@/lib/private-cache';

import { json, requireFinanceUser } from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const visibilityCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 300,
  staleWhileRevalidateSeconds: 900,
});

const visibilityCacheControl = privateCacheControl({
  maxAgeSeconds: 300,
  staleWhileRevalidateSeconds: 900,
});

export async function GET() {
  const timer = createPerfTimer('api/financeiro/antecipacoes/visibilidade');

  try {
    const auth = await requireFinanceUser({ checkAccountGate: false });
    if (!auth.ok) return auth.response;

    const cached = visibilityCache.get(auth.user.contaId);
    if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
      timer.end('GET /antecipacoes/visibilidade (cache hit)', { cacheState: cached.state });
      return json(200, cached.body, {
        'cache-control': visibilityCacheControl,
        'x-alusa-cache': cached.state,
      });
    }

    const data = await withPerfTimer(
      'api/financeiro/antecipacoes/visibilidade',
      'getAutomaticAnticipationMenuVisibility',
      () => getAutomaticAnticipationMenuVisibility({ contaId: auth.user.contaId }),
      { contaId: auth.user.contaId },
    );

    const body = { data };
    visibilityCache.set(auth.user.contaId, body);

    timer.end('GET /antecipacoes/visibilidade (cache miss)');
    return json(200, body, {
      'cache-control': visibilityCacheControl,
      'x-alusa-cache': 'MISS',
    });
  } catch (error) {
    console.error('[API antecipacoes visibilidade][GET]', error);
    return json(500, {
      data: {
        showAutomaticAnticipationItem: true,
        accountPersonType: null,
      },
    });
  }
}