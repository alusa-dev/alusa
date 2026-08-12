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

  private key(accountKey: string, endpointClass?: string): string {
    return endpointClass ? `${accountKey}::${endpointClass}` : accountKey;
  }

  update(accountKey: string, endpointClass: string, info: RateLimitInfo): void;
  update(endpointClass: string, info: RateLimitInfo): void;
  update(accountKeyOrEndpoint: string, endpointOrInfo: string | RateLimitInfo, maybeInfo?: RateLimitInfo): void {
    const endpointClass = typeof endpointOrInfo === 'string' ? endpointOrInfo : accountKeyOrEndpoint;
    const info = typeof endpointOrInfo === 'string' ? maybeInfo : endpointOrInfo;
    if (!info) return;
    if (info.limit === null && info.remaining === null && info.resetSeconds === null) return;
    const stateKey = typeof endpointOrInfo === 'string'
      ? this.key(accountKeyOrEndpoint, endpointClass)
      : this.key(endpointClass);
    this.state.set(stateKey, info);

    // Emitir hook quando remaining chega a 0
    if (info.remaining !== null && info.remaining <= 0) {
      globalAsaasHooks.emitRateLimitHit({
        accountKey: typeof endpointOrInfo === 'string' ? accountKeyOrEndpoint : endpointClass,
        endpoint: endpointClass,
        resetSeconds: info.resetSeconds,
      });
    }
  }

  get(accountKey: string, endpointClass: string): RateLimitInfo | null;
  get(endpointClass: string): RateLimitInfo | null;
  get(accountKeyOrEndpoint: string, maybeEndpoint?: string): RateLimitInfo | null {
    return this.state.get(this.key(accountKeyOrEndpoint, maybeEndpoint)) ?? null;
  }

  isNearLimit(accountKey: string, endpointClass: string, threshold?: number): boolean;
  isNearLimit(endpointClass: string, threshold?: number): boolean;
  isNearLimit(accountKeyOrEndpoint: string, endpointOrThreshold: string | number = 5, maybeThreshold = 5): boolean {
    const endpointClass = typeof endpointOrThreshold === 'string' ? endpointOrThreshold : accountKeyOrEndpoint;
    const threshold = typeof endpointOrThreshold === 'string' ? maybeThreshold : endpointOrThreshold;
    const key = typeof endpointOrThreshold === 'string' ? this.key(accountKeyOrEndpoint, endpointClass) : this.key(endpointClass);
    const info = this.state.get(key);
    if (!info || info.remaining === null) return false;
    return info.remaining <= threshold;
  }

  shouldBackoff(accountKey: string, endpointClass: string): { backoff: boolean; waitMs: number };
  shouldBackoff(endpointClass: string): { backoff: boolean; waitMs: number };
  shouldBackoff(accountKeyOrEndpoint: string, maybeEndpoint?: string): { backoff: boolean; waitMs: number } {
    const info = this.state.get(this.key(accountKeyOrEndpoint, maybeEndpoint));
    if (!info) return { backoff: false, waitMs: 0 };

    if (info.remaining !== null && info.remaining <= 0 && info.resetSeconds !== null) {
      // Mantém a API legada determinística; o cliente usa a forma escopada por conta.
      const elapsedMs = maybeEndpoint === undefined ? 0 : Math.max(0, Date.now() - info.capturedAt);
      return { backoff: true, waitMs: Math.max(0, info.resetSeconds * 1000 - elapsedMs) };
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
