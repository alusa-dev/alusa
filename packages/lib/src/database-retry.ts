const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  'P2024',
  'P1001',
  'P1008',
  'P1017',
]);

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Identifica falhas que podem desaparecer quando uma conexão ociosa é
 * encerrada pelo pooler/serverless. Erros de domínio ou de validação nunca
 * devem ser repetidos automaticamente.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const code = errorCode(error);

  return (
    (code !== undefined && TRANSIENT_DATABASE_ERROR_CODES.has(code)) ||
    normalized.includes('connection pool') ||
    normalized.includes('connection refused') ||
    normalized.includes('connection reset') ||
    normalized.includes('connection terminated') ||
    normalized.includes('timed out fetching a new connection') ||
    normalized.includes('econnreset') ||
    normalized.includes('etimedout')
  );
}

export type DatabaseRetryOptions = {
  maxRetries?: number;
  delayMs?: number;
};

/**
 * Retry curto e limitado para leituras idempotentes. O padrão de uma única
 * tentativa adicional evita tempestades e não transforma indisponibilidade em
 * carga persistente no banco.
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  { maxRetries = 1, delayMs = 50 }: DatabaseRetryOptions = {},
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isTransientDatabaseError(error)) {
        throw error;
      }

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
