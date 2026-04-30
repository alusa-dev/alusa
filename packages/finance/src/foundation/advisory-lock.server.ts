import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@alusa/database';

/**
 * Converte uma string de lock em um bigint de 63 bits (signed) usando SHA-256.
 * Determinístico: mesma string → mesmo bigint.
 * PostgreSQL bigint é signed (-2^63 a 2^63-1), então usamos apenas 63 bits.
 */
export function advisoryLockKey64(lockKey: string): bigint {
  const hash = createHash('sha256').update(lockKey).digest('hex');
  // Pegar os primeiros 16 hex chars (64 bits) e converter para BigInt
  const hexPrefix = hash.slice(0, 16);
  const unsigned = BigInt(`0x${hexPrefix}`);
  // Limitar ao range de bigint signed do PostgreSQL (63 bits)
  // Máximo: 2^63-1 = 9223372036854775807
  const MAX_SIGNED_BIGINT = BigInt('9223372036854775807');
  return unsigned & MAX_SIGNED_BIGINT;
}

export interface WithAdvisoryLockOptions {
  prisma?: PrismaClient;
  logContext?: Record<string, unknown>;
  /** Timeout da transação em milissegundos. Default: 20000 (20s) */
  timeout?: number;
}

export type WithAdvisoryLockResult<T> =
  | { acquired: true; result: T }
  | { acquired: false };

/**
 * Executa uma função com um advisory lock transacional (transaction-level).
 *
 * Garante que o lock seja mantido durante toda a execução da função `fn`,
 * utilizando `prisma.$transaction` e `pg_try_advisory_xact_lock`.
 * O lock é liberado automaticamente quando a transação termina (commit ou rollback).
 *
 * Isso resolve problemas de connection pooling onde locks de sessão podiam ser perdidos
 * ou não liberados corretamente se a conexão mudasse.
 */
export async function withAdvisoryLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  options?: WithAdvisoryLockOptions,
): Promise<WithAdvisoryLockResult<T>> {
  const db = options?.prisma ?? defaultPrisma;
  const lockId = advisoryLockKey64(lockKey);
  const timeout = options?.timeout ?? 20000;

  try {
    return await db.$transaction(async (tx) => {
      // Tentar adquirir lock transaction-level
      // Retorna true se adquiriu imediatamente, false se já estava ocupado
      const result = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(${lockId.toString()}::bigint) AS locked`
      );
      const acquired = result[0]?.locked ?? false;

      if (!acquired) {
        if (process.env.NODE_ENV !== 'production') {
          console.debug('[advisory-lock] Lock ocupado (não adquirido)', {
            lockKeyPrefix: lockKey.split(':')[0],
            ...options?.logContext,
          });
        }
        return { acquired: false };
      }

      if (process.env.NODE_ENV !== 'production') {
        console.debug('[advisory-lock] Lock adquirido (xact)', {
          lockKeyPrefix: lockKey.split(':')[0],
          ...options?.logContext,
        });
      }

      // Executar a função protegida
      // A transação permanece aberta enquanto fn executa
      const execResult = await fn();

      return { acquired: true, result: execResult };
    }, {
      timeout,
      maxWait: 5000,
    });
  } catch (error) {
    console.error('[advisory-lock] Erro na execução protegida pelo lock', {
      lockKeyPrefix: lockKey.split(':')[0],
      error: error instanceof Error ? error.message : String(error),
      ...options?.logContext,
    });
    throw error;
  }
}

// Deprecated: Funções manuais não são seguras com pooling do Prisma.
// Mantidas apenas para compatibilidade se algum código legado depender, mas
// redirecionando para avisar ou no-op no futuro.
export async function tryAcquireAdvisoryLock(): Promise<boolean> {
  console.warn('[advisory-lock] tryAcquireAdvisoryLock é inseguro com pooling e foi desativado. Use withAdvisoryLock.');
  return false;
}

export async function releaseAdvisoryLock(): Promise<boolean> {
  return true;
}