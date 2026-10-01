import type { Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { logRuntimeOperationalEvent } from '@/lib/observability/runtime-operational-log';

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
    logRuntimeOperationalEvent({ eventName: 'auth.session.lookup_failed', error, severity: 'warn' });
    return null;
  }
}
