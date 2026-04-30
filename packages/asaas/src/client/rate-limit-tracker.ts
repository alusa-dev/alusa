/**
 * Rate limit tracking para API do Asaas.
 *
 * Captura e expõe os headers oficiais de rate limit:
 * - RateLimit-Limit
 * - RateLimit-Remaining
 * - RateLimit-Reset
 *
 * Permite que o sistema ajuste vazão proativamente.
 */

import { globalAsaasHooks } from './asaas-hooks';

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
  capturedAt: number;
}

export function extractRateLimitHeaders(headers: {
  get(name: string): string | null;
}): RateLimitInfo {
  const limitRaw = headers.get('ratelimit-limit') ?? headers.get('RateLimit-Limit');
  const remainingRaw = headers.get('ratelimit-remaining') ?? headers.get('RateLimit-Remaining');
  const resetRaw = headers.get('ratelimit-reset') ?? headers.get('RateLimit-Reset');

  const limit = limitRaw !== null ? Number(limitRaw) : null;
  const remaining = remainingRaw !== null ? Number(remainingRaw) : null;
  const resetSeconds = resetRaw !== null ? Number(resetRaw) : null;

  return {
    limit: limit !== null && Number.isFinite(limit) ? limit : null,
    remaining: remaining !== null && Number.isFinite(remaining) ? remaining : null,
    resetSeconds: resetSeconds !== null && Number.isFinite(resetSeconds) ? resetSeconds : null,
    capturedAt: Date.now(),
  };
}

/**
 * Armazena o último rate limit info por endpoint-class (em memória).
 * Útil para diagnóstico e para decidir se é seguro fazer mais requests.
 */
export class RateLimitTracker {
  private readonly state = new Map<string, RateLimitInfo>();

  update(endpointClass: string, info: RateLimitInfo): void {
    if (info.limit === null && info.remaining === null && info.resetSeconds === null) return;
    this.state.set(endpointClass, info);

    // Emitir hook quando remaining chega a 0
    if (info.remaining !== null && info.remaining <= 0) {
      globalAsaasHooks.emitRateLimitHit({
        accountKey: endpointClass,
        endpoint: endpointClass,
        resetSeconds: info.resetSeconds,
      });
    }
  }

  get(endpointClass: string): RateLimitInfo | null {
    return this.state.get(endpointClass) ?? null;
  }

  isNearLimit(endpointClass: string, threshold = 5): boolean {
    const info = this.state.get(endpointClass);
    if (!info || info.remaining === null) return false;
    return info.remaining <= threshold;
  }

  shouldBackoff(endpointClass: string): { backoff: boolean; waitMs: number } {
    const info = this.state.get(endpointClass);
    if (!info) return { backoff: false, waitMs: 0 };

    if (info.remaining !== null && info.remaining <= 0 && info.resetSeconds !== null) {
      return { backoff: true, waitMs: info.resetSeconds * 1000 };
    }
    return { backoff: false, waitMs: 0 };
  }

  snapshot(): Record<string, RateLimitInfo> {
    return Object.fromEntries(this.state);
  }

  clear(): void {
    this.state.clear();
  }
}

export const globalRateLimitTracker = new RateLimitTracker();
