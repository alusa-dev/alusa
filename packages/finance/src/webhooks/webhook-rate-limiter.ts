/**
 * Rate limiter em memória para o endpoint de webhook.
 * 
 * Sliding window counter por IP.
 * Protege contra flood/DDoS no endpoint público.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

export class WebhookRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(opts?: { maxRequests?: number; windowMs?: number }) {
    this.maxRequests = opts?.maxRequests ?? 200;
    this.windowMs = opts?.windowMs ?? 60_000; // 1 minuto
  }

  /**
   * Retorna true se a requisição é permitida (dentro do limite).
   */
  check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.windows.set(key, { count: 1, windowStart: now });
      return { allowed: true, remaining: this.maxRequests - 1, resetMs: this.windowMs };
    }

    entry.count++;
    const remaining = Math.max(0, this.maxRequests - entry.count);
    const resetMs = this.windowMs - (now - entry.windowStart);

    if (entry.count > this.maxRequests) {
      return { allowed: false, remaining: 0, resetMs };
    }

    return { allowed: true, remaining, resetMs };
  }

  /**
   * Limpa entradas expiradas (para evitar memory leak).
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now - entry.windowStart >= this.windowMs * 2) {
        this.windows.delete(key);
      }
    }
  }
}

// Singleton — 200 req/min por IP por padrão
export const globalWebhookRateLimiter = new WebhookRateLimiter();

// Limpeza periódica (a cada 5 minutos)
if (typeof setInterval !== 'undefined') {
  setInterval(() => globalWebhookRateLimiter.cleanup(), 5 * 60_000).unref?.();
}
