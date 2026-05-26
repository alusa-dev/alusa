/**
 * CorrelationId — propagação via AsyncLocalStorage.
 *
 * Permite que um correlationId gerado no ingress (webhook, API route)
 * seja acessível por qualquer serviço downstream sem prop-drilling.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface CorrelationContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Executa fn dentro de um contexto com correlationId.
 * Se já existir contexto, reutiliza (não sobrescreve).
 */
export function withCorrelationId<T>(fn: () => T, correlationId?: string): T {
  const existing = storage.getStore();
  if (existing) return fn();
  return storage.run({ correlationId: correlationId ?? randomUUID() }, fn);
}

/**
 * Retorna o correlationId do contexto atual (ou undefined se fora de contexto).
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Gera correlationId para uso em fluxos que não passam por withCorrelationId.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}
