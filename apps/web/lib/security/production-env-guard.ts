type ProductionSecurityEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  RLS_RUNTIME_ENABLED?: string;
  DATABASE_RLS_URL?: string;
};

export function isProductionDeployment(env: ProductionSecurityEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

export function assertProductionSecurityEnv(env: ProductionSecurityEnv = process.env): void {
  if (!isProductionDeployment(env)) return;

  const missing: string[] = [];
  if (env.RLS_RUNTIME_ENABLED !== 'true') {
    missing.push('RLS_RUNTIME_ENABLED=true');
  }
  if (!env.DATABASE_RLS_URL?.trim()) {
    missing.push('DATABASE_RLS_URL');
  }

  if (missing.length > 0) {
    throw new Error(
      `[security] Producao exige runtime RLS obrigatorio. Configure: ${missing.join(', ')}.`,
    );
  }
}
