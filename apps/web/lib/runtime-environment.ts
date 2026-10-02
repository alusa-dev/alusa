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
  void scope;
}
