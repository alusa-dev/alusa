import { asaasRedisCommand, getAsaasRedisConfig } from './redis-rest';

export type AsaasRedisHealth = {
  configured: boolean;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
};

/**
 * Verifica somente a disponibilidade operacional do Redis usado pelos
 * controles distribuídos do Asaas. Nunca expõe URL ou token.
 */
export async function checkAsaasRedisHealth(timeoutMs = 2_000): Promise<AsaasRedisHealth> {
  const config = getAsaasRedisConfig();
  if (!config) {
    return {
      configured: false,
      reachable: false,
      latencyMs: null,
      error: 'ASAAS_REDIS_ENABLED/credenciais Redis não configuradas.',
    };
  }

  const startedAt = Date.now();
  try {
    await asaasRedisCommand(config, ['PING'], { signal: AbortSignal.timeout(timeoutMs) });
    return {
      configured: true,
      reachable: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isAsaasRedisConfigured(): boolean {
  return Boolean(getAsaasRedisConfig());
}
