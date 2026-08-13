type ProductionSecurityEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  RLS_RUNTIME_ENABLED?: string;
  DATABASE_RLS_URL?: string;
  ASAAS_REDIS_ENABLED?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  FIN_WEBHOOK_SYNC_OVERRIDE?: string;
  FIN_WEBHOOK_INLINE_DRAIN?: string;
  ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS?: string;
  ASAAS_WEBHOOK_AUTH_TOKEN_SECRET?: string;
  ASAAS_WEBHOOK_PUBLIC_BASE_URL?: string;
  CRON_SECRET?: string;
  CRON_SECRET_TOKEN?: string;
  CACHE_LAYER_ENABLED?: string;
  REDIS_CACHE_ENABLED?: string;
  ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED?: string;
};

function isEnabled(value: string | undefined): boolean {
  return value?.trim() === 'true';
}

export function isProductionDeployment(env: ProductionSecurityEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

export function assertProductionSecurityEnv(env: ProductionSecurityEnv = process.env): void {
  if (!isProductionDeployment(env)) return;

  const missing: string[] = [];
  if (!isEnabled(env.RLS_RUNTIME_ENABLED)) {
    missing.push('RLS_RUNTIME_ENABLED=true');
  }
  if (!env.DATABASE_RLS_URL?.trim()) {
    missing.push('DATABASE_RLS_URL');
  }

  if (!isEnabled(env.ASAAS_REDIS_ENABLED)) {
    missing.push('ASAAS_REDIS_ENABLED=true');
  }
  if (!env.UPSTASH_REDIS_REST_URL?.trim()) {
    missing.push('UPSTASH_REDIS_REST_URL');
  }
  if (!env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
    missing.push('UPSTASH_REDIS_REST_TOKEN');
  }
  if (isEnabled(env.FIN_WEBHOOK_SYNC_OVERRIDE)) {
    missing.push('FIN_WEBHOOK_SYNC_OVERRIDE=false ou ausente');
  }
  if (isEnabled(env.FIN_WEBHOOK_INLINE_DRAIN)) {
    missing.push('FIN_WEBHOOK_INLINE_DRAIN=false ou ausente');
  }
  if (!isEnabled(env.ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS)) {
    missing.push('ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS=true');
  }
  if (!env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET?.trim()) {
    missing.push('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET');
  }
  if (!env.ASAAS_WEBHOOK_PUBLIC_BASE_URL?.trim()) {
    missing.push('ASAAS_WEBHOOK_PUBLIC_BASE_URL');
  }
  if (!env.CRON_SECRET?.trim() && !env.CRON_SECRET_TOKEN?.trim()) {
    missing.push('CRON_SECRET ou CRON_SECRET_TOKEN');
  }
  if (!isEnabled(env.CACHE_LAYER_ENABLED)) {
    missing.push('CACHE_LAYER_ENABLED=true');
  }
  if (!isEnabled(env.REDIS_CACHE_ENABLED)) {
    missing.push('REDIS_CACHE_ENABLED=true');
  }
  if (env.ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED?.trim() === 'false') {
    missing.push('ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED=true ou ausente');
  }

  if (missing.length > 0) {
    throw new Error(
      `[security] Producao exige runtime seguro e controles distribuídos. Configure: ${missing.join(', ')}.`,
    );
  }
}
