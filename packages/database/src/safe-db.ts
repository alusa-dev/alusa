export type DatabaseEnvMode = 'dev' | 'test';

type ParsedConnection = {
  value: string;
  host: string;
  databaseName: string;
};

function parseConnectionString(rawValue: string | undefined): ParsedConnection | null {
  const value = rawValue?.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return {
      value,
      host: parsed.hostname.toLowerCase(),
      databaseName: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).toLowerCase(),
    };
  } catch {
    return {
      value,
      host: '',
      databaseName: '',
    };
  }
}

function isProductionLike(connection: ParsedConnection | null) {
  if (!connection) return false;
  const haystack = `${connection.host} ${connection.databaseName} ${connection.value.toLowerCase()}`;
  return haystack.includes('alusa_prod') || connection.databaseName.endsWith('_prod');
}

function isTestLike(connection: ParsedConnection | null) {
  if (!connection) return false;
  return connection.databaseName.includes('test');
}

function isLocalConnection(connection: ParsedConnection | null) {
  if (!connection) return false;
  return connection.host === 'localhost' || connection.host === '127.0.0.1';
}

export function assertSafeDatabaseEnv(mode: DatabaseEnvMode) {
  const databaseUrl = parseConnectionString(process.env.DATABASE_URL);
  const directUrl = parseConnectionString(process.env.DIRECT_URL);

  if (!databaseUrl) return;

  if (isProductionLike(databaseUrl) || isProductionLike(directUrl)) {
    throw new Error(
      'DATABASE_URL/DIRECT_URL aponta para producao em runtime local. Troque para um banco local ou de teste antes de continuar.',
    );
  }

  if (mode === 'test') {
    if (!isTestLike(databaseUrl)) {
      throw new Error(
        `DATABASE_URL de teste precisa apontar para um banco *_test. Atual: ${databaseUrl.databaseName || databaseUrl.value}`,
      );
    }
    return;
  }

  if (!isLocalConnection(databaseUrl) && process.env.ALLOW_REMOTE_DEV_DB !== 'true') {
    throw new Error(
      'DATABASE_URL de desenvolvimento precisa apontar para localhost/127.0.0.1. Use ALLOW_REMOTE_DEV_DB=true apenas para banco remoto nao produtivo.',
    );
  }
}