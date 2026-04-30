/**
 * Asaas Hooks — Observer pattern para eventos do cliente HTTP.
 *
 * Permite que consumers (ex: packages/finance) registrem callbacks
 * para eventos do AsaasHttp sem criar dependência circular.
 *
 * Eventos:
 * - apiCall: disparado após cada request HTTP
 * - circuitOpen: disparado quando o circuit breaker abre
 * - quotaWarning: disparado quando quota atinge 80%+
 * - rateLimitHit: disparado quando remaining <= 0
 */

export interface ApiCallHookPayload {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  accountKey: string;
  httpStatus: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  circuitState?: string;
  rateLimitRemaining?: number;
  quotaRemaining?: number;
}

export interface CircuitOpenHookPayload {
  accountKey: string;
  failures: number;
  cooldownMs: number;
}

export interface QuotaWarningHookPayload {
  accountKey: string;
  used: number;
  limit: number;
  percentUsed: number;
  exceeded: boolean;
}

export interface RateLimitHitHookPayload {
  accountKey: string;
  endpoint: string;
  resetSeconds: number | null;
}

type Listener<T> = (payload: T) => void;

class AsaasHooks {
  private apiCallListeners: Listener<ApiCallHookPayload>[] = [];
  private circuitOpenListeners: Listener<CircuitOpenHookPayload>[] = [];
  private quotaWarningListeners: Listener<QuotaWarningHookPayload>[] = [];
  private rateLimitHitListeners: Listener<RateLimitHitHookPayload>[] = [];

  onApiCall(listener: Listener<ApiCallHookPayload>): () => void {
    this.apiCallListeners.push(listener);
    return () => {
      this.apiCallListeners = this.apiCallListeners.filter((l) => l !== listener);
    };
  }

  onCircuitOpen(listener: Listener<CircuitOpenHookPayload>): () => void {
    this.circuitOpenListeners.push(listener);
    return () => {
      this.circuitOpenListeners = this.circuitOpenListeners.filter((l) => l !== listener);
    };
  }

  onQuotaWarning(listener: Listener<QuotaWarningHookPayload>): () => void {
    this.quotaWarningListeners.push(listener);
    return () => {
      this.quotaWarningListeners = this.quotaWarningListeners.filter((l) => l !== listener);
    };
  }

  onRateLimitHit(listener: Listener<RateLimitHitHookPayload>): () => void {
    this.rateLimitHitListeners.push(listener);
    return () => {
      this.rateLimitHitListeners = this.rateLimitHitListeners.filter((l) => l !== listener);
    };
  }

  /** @internal — chamado pelo AsaasHttp e trackers */
  emitApiCall(payload: ApiCallHookPayload): void {
    for (const listener of this.apiCallListeners) {
      try { listener(payload); } catch { /* fail-safe */ }
    }
  }

  /** @internal */
  emitCircuitOpen(payload: CircuitOpenHookPayload): void {
    for (const listener of this.circuitOpenListeners) {
      try { listener(payload); } catch { /* fail-safe */ }
    }
  }

  /** @internal */
  emitQuotaWarning(payload: QuotaWarningHookPayload): void {
    for (const listener of this.quotaWarningListeners) {
      try { listener(payload); } catch { /* fail-safe */ }
    }
  }

  /** @internal */
  emitRateLimitHit(payload: RateLimitHitHookPayload): void {
    for (const listener of this.rateLimitHitListeners) {
      try { listener(payload); } catch { /* fail-safe */ }
    }
  }

  /** Remove todos os listeners (para testes). */
  removeAllListeners(): void {
    this.apiCallListeners = [];
    this.circuitOpenListeners = [];
    this.quotaWarningListeners = [];
    this.rateLimitHitListeners = [];
  }
}

export const globalAsaasHooks = new AsaasHooks();
