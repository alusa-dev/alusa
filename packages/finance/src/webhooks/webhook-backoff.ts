/**
 * Backoff exponencial para reprocessamento de webhooks.
 *
 * Fórmula: min(baseMs * 2^attempt + jitter, maxMs)
 * Garante que webhooks com falhas repetidas não congestionem a fila.
 */

const BASE_DELAY_MS = 5_000; // 5s
const MAX_DELAY_MS = 15 * 60 * 1000; // 15min
const JITTER_FACTOR = 0.2;

function jitter(ms: number): number {
  const variance = ms * JITTER_FACTOR;
  return Math.round(ms + (Math.random() * 2 - 1) * variance);
}

/**
 * Calcula o delay de backoff para uma tentativa.
 * attempt=0 → sem delay (primeira tentativa)
 * attempt=1 → ~5s, attempt=2 → ~10s, attempt=3 → ~20s, etc.
 */
export function computeBackoffDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  const raw = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  return jitter(Math.min(raw, MAX_DELAY_MS));
}

/**
 * Calcula a data a partir da qual o webhook pode ser reprocessado.
 */
export function computeNextRetryAt(attempt: number, now?: Date): Date {
  const delayMs = computeBackoffDelayMs(attempt);
  const base = now ?? new Date();
  return new Date(base.getTime() + delayMs);
}
