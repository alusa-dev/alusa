/**
 * Circuit Breaker para chamadas de saída à API do Asaas.
 *
 * Se uma subconta está retornando erros persistentes (5xx, 429),
 * o circuito abre e bloqueia novas chamadas por um cooldown,
 * evitando bombardear uma API degradada.
 *
 * Estados:
 * - CLOSED: operação normal, chamadas passam
 * - OPEN: bloqueado, chamadas rejeitadas com erro imediato
 * - HALF_OPEN: tenta uma chamada de teste para decidir se fecha
 */

import { globalAsaasHooks } from './asaas-hooks';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Falhas consecutivas para abrir o circuito (default: 5) */
  failureThreshold: number;
  /** Tempo em ms para manter o circuito aberto antes de testar (default: 30s) */
  cooldownMs: number;
  /** Status HTTP considerados falha para o circuit breaker */
  failureStatuses: number[];
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  openedAt: number | null;
  lastSuccessAt: number | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  failureStatuses: [429, 500, 502, 503, 504],
};

export class CircuitBreaker {
  private readonly circuits = new Map<string, CircuitEntry>();
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getOrCreate(key: string): CircuitEntry {
    let entry = this.circuits.get(key);
    if (!entry) {
      entry = {
        state: 'CLOSED',
        failures: 0,
        lastFailureAt: 0,
        openedAt: null,
        lastSuccessAt: null,
      };
      this.circuits.set(key, entry);
    }
    return entry;
  }

  /**
   * Verifica se a chamada é permitida.
   * Se o circuito está OPEN e o cooldown passou, transiciona para HALF_OPEN.
   */
  canExecute(key: string): { allowed: boolean; state: CircuitState; waitMs?: number } {
    const entry = this.getOrCreate(key);

    if (entry.state === 'CLOSED') {
      return { allowed: true, state: 'CLOSED' };
    }

    if (entry.state === 'OPEN') {
      const elapsed = Date.now() - (entry.openedAt ?? 0);
      if (elapsed >= this.config.cooldownMs) {
        entry.state = 'HALF_OPEN';
        return { allowed: true, state: 'HALF_OPEN' };
      }
      return {
        allowed: false,
        state: 'OPEN',
        waitMs: this.config.cooldownMs - elapsed,
      };
    }

    // HALF_OPEN: permite uma chamada de teste
    return { allowed: true, state: 'HALF_OPEN' };
  }

  recordSuccess(key: string): void {
    const entry = this.getOrCreate(key);
    entry.failures = 0;
    entry.state = 'CLOSED';
    entry.lastSuccessAt = Date.now();
    entry.openedAt = null;
  }

  recordFailure(key: string, status?: number): void {
    if (status !== undefined && !this.config.failureStatuses.includes(status)) {
      // 4xx que não são 429 não contam como falha de circuito
      return;
    }

    const entry = this.getOrCreate(key);
    entry.failures += 1;
    entry.lastFailureAt = Date.now();

    if (entry.state === 'HALF_OPEN') {
      // Falhou no teste — volta para OPEN
      entry.state = 'OPEN';
      entry.openedAt = Date.now();
      return;
    }

    if (entry.failures >= this.config.failureThreshold) {
      entry.state = 'OPEN';
      entry.openedAt = Date.now();

      console.warn('[circuit-breaker] Circuito aberto', {
        key,
        failures: entry.failures,
        threshold: this.config.failureThreshold,
        cooldownMs: this.config.cooldownMs,
      });

      globalAsaasHooks.emitCircuitOpen({
        accountKey: key,
        failures: entry.failures,
        cooldownMs: this.config.cooldownMs,
      });
    }
  }

  getState(key: string): CircuitState {
    return this.getOrCreate(key).state;
  }

  getSnapshot(key: string): Readonly<CircuitEntry> {
    return { ...this.getOrCreate(key) };
  }

  /** Reseta manualmente o circuito (para recovery administrativo) */
  reset(key: string): void {
    this.circuits.delete(key);
  }

  resetAll(): void {
    this.circuits.clear();
  }

  /** Snapshot de todos os circuitos para diagnóstico */
  allSnapshots(): Record<string, Readonly<CircuitEntry>> {
    const result: Record<string, Readonly<CircuitEntry>> = {};
    for (const [key, entry] of this.circuits) {
      result[key] = { ...entry };
    }
    return result;
  }
}

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN';
  readonly waitMs: number;

  constructor(key: string, waitMs: number) {
    super(`Circuit breaker aberto para ${key}. Aguarde ${Math.ceil(waitMs / 1000)}s.`);
    this.name = 'CircuitOpenError';
    this.waitMs = waitMs;
  }
}

// Instância global — uma por processo, keyed por contaId ou apiKey hash
export const globalCircuitBreaker = new CircuitBreaker();
