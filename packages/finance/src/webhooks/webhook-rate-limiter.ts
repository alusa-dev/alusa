/**
 * Rate limiter em memória para o endpoint de webhook.
 * 
 * Sliding window counter por IP.
 * Protege contra flood/DDoS no endpoint público.
 */

import { checkAsaasDistributedRateLimit } from '@alusa/asaas';

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
   * Usa a janela distribuída quando Redis está configurado. Em caso de falha,
   * mantém o fallback local para não transformar uma indisponibilidade do
   * mecanismo de proteção em perda silenciosa de webhooks legítimos.
   */
  async checkAsync(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetMs: number;
    backend: 'redis' | 'memory';
    degraded: boolean;
  }> {
    try {
      const distributed = await checkAsaasDistributedRateLimit({
        key,
        maxRequests: this.maxRequests,
        windowMs: this.windowMs,
      });
      if (distributed) return { ...distributed, degraded: false };
    } catch (error) {
      console.warn('[webhook-rate-limiter] Redis indisponível; fallback local ativado', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    return { ...this.check(key), backend: 'memory', degraded: true };
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

export function isWebhookAuthScopedRateLimitEnabled(): boolean {
  const configured = process.env.ASAAS_WEBHOOK_AUTH_SCOPED_RATE_LIMIT;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function buildWebhookRateLimitKey(params: {
  ip: string | null;
  contaId?: string | null;
  tokenHashPrefix?: string | null;
}): string {
  const ipPart = params.ip ?? 'unknown';
  if (!isWebhookAuthScopedRateLimitEnabled()) {
    return `ip:${ipPart}`;
  }

  const tenantPart = params.contaId ? `conta:${params.contaId}` : 'conta:unknown';
  const tokenPart = params.tokenHashPrefix ? `token:${params.tokenHashPrefix}` : 'token:missing';
  return `${tenantPart}:${tokenPart}:ip:${ipPart}`;
}

// Singleton — 200 req/min por IP por padrão
export const globalWebhookRateLimiter = new WebhookRateLimiter();

// Limpeza periódica (a cada 5 minutos)
if (typeof setInterval !== 'undefined') {
  setInterval(() => globalWebhookRateLimiter.cleanup(), 5 * 60_000).unref?.();
}
