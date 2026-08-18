export interface AsaasRedisConfig {
  url: string;
  token: string;
}

export interface AsaasRedisCommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function resolveRedisTimeoutMs(): number {
  const configured = Number(process.env.ASAAS_REDIS_TIMEOUT_MS ?? 1_500);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 1_500;
}

export function getAsaasRedisConfig(): AsaasRedisConfig | null {
  if (process.env.ASAAS_REDIS_ENABLED === 'false') return null;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;

  return { url: url.replace(/\/+$/, ''), token };
}

export async function asaasRedisCommand<T = unknown>(
  config: AsaasRedisConfig,
  command: string[],
  options: AsaasRedisCommandOptions = {},
): Promise<T> {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? resolveRedisTimeoutMs()),
  });

  if (!response.ok) throw new Error(`Redis REST ${response.status}`);

  const body = await response.json() as { result?: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

export async function asaasRedisEval<T = unknown>(
  config: AsaasRedisConfig,
  script: string,
  keys: string[],
  args: string[],
): Promise<T> {
  return asaasRedisCommand<T>(config, [
    'EVAL',
    script,
    String(keys.length),
    ...keys,
    ...args,
  ]);
}

export function sanitizeAsaasRedisKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_');
}
