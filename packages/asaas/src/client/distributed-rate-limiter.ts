import { asaasRedisEval, getAsaasRedisConfig, sanitizeAsaasRedisKeyPart } from './redis-rest';

export type DistributedRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  backend: 'redis';
};

/**
 * Reserva uma unidade em uma janela fixa usando uma única operação Redis
 * atômica. O TTL só é aplicado na primeira unidade, evitando a corrida
 * INCR + EXPIRE entre réplicas.
 */
export async function checkAsaasDistributedRateLimit(params: {
  key: string;
  maxRequests: number;
  windowMs: number;
}): Promise<DistributedRateLimitResult | null> {
  const config = getAsaasRedisConfig();
  if (!config) return null;

  const prefix = process.env.ASAAS_WEBHOOK_RATE_LIMIT_REDIS_KEY_PREFIX ?? 'alusa:asaas:webhook-rate';
  const redisKey = `${prefix}:${sanitizeAsaasRedisKeyPart(params.key)}`;
  const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('PTTL', KEYS[1])
local limit = tonumber(ARGV[1])
return {count <= limit and 1 or 0, math.max(0, limit - count), math.max(0, ttl)}
`;

  const result = await asaasRedisEval<Array<number | string>>(
    config,
    script,
    [redisKey],
    [String(Math.max(1, Math.trunc(params.maxRequests))), String(Math.max(1, Math.trunc(params.windowMs)))],
  );

  return {
    allowed: Number(result?.[0]) === 1,
    remaining: Math.max(0, Number(result?.[1] ?? 0)),
    resetMs: Math.max(0, Number(result?.[2] ?? params.windowMs)),
    backend: 'redis',
  };
}
