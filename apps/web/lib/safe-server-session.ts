import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Obtém a sessão do usuário lidando com ambientes de teste onde o mock pode
 * retornar um valor síncrono ao invés de uma Promise.
 */
export async function safeGetServerSession(): Promise<Session | null> {
  try {
    const result = getServerSession(authOptions) as Session | null | Promise<Session | null>;

    if (result instanceof Promise) {
      return await result;
    }

    if (isThenable<Session | null>(result)) {
      return await result;
    }

    return result;
  } catch (error) {
    console.warn('[safeGetServerSession] Falha ao obter sessão', error);
    return null;
  }
}
