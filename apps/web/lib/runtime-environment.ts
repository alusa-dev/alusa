function parseHostname(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    const withoutCredentials = value.replace(/^[^@]+@/, '');
    return withoutCredentials.split('/')[0]?.split(':')[0] ?? null;
  }
}

export function getRuntimeEnvironmentSnapshot() {
  const databaseHost = parseHostname(process.env.DATABASE_URL);
  const directHost = parseHostname(process.env.DIRECT_URL);

  return {
    vercelRegion: process.env.VERCEL_REGION ?? process.env.VERCEL_REGION_ID ?? 'local',
    databaseHost,
    directHost,
    databaseUsesNeonPooler: databaseHost?.includes('-pooler.') ?? false,
    databaseLooksSaEast1: databaseHost?.includes('sa-east-1') ?? false,
    directUsesNeonPooler: directHost?.includes('-pooler.') ?? false,
  };
}

export function logRuntimeEnvironmentOnce(scope: string) {
  if (process.env.PERF_LOGS !== '1') return;

  const globalForRuntime = globalThis as typeof globalThis & {
    __alusaRuntimeEnvironmentLogged?: Set<string>;
  };
  globalForRuntime.__alusaRuntimeEnvironmentLogged ??= new Set<string>();
  if (globalForRuntime.__alusaRuntimeEnvironmentLogged.has(scope)) return;

  globalForRuntime.__alusaRuntimeEnvironmentLogged.add(scope);
  console.log('[runtime][environment]', {
    scope,
    ...getRuntimeEnvironmentSnapshot(),
  });
}
