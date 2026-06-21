import { z } from 'zod';

const environmentSchema = z.enum(['development', 'staging', 'production', 'test']);

const envSchema = z.object({
  apiUrl: z.string().url('EXPO_PUBLIC_API_URL deve ser uma URL válida.'),
  environment: environmentSchema.default('development'),
  sentryDsn: z.string().url().optional(),
  mobileAuthEnabled: z.boolean().default(false),
});

export type MobileEnvironment = z.infer<typeof envSchema>;

type EnvSource = Record<string, string | undefined>;

function readBoolean(value: string | undefined) {
  return value === 'true' || value === '1';
}

export function loadMobileEnv(source: EnvSource = process.env): MobileEnvironment {
  const environment = source.EXPO_PUBLIC_ENVIRONMENT ?? source.NODE_ENV ?? 'development';
  const apiUrl =
    source.EXPO_PUBLIC_API_URL ??
    (environment === 'development' || environment === 'test' ? 'http://localhost:3000' : undefined);

  const parsed = envSchema.safeParse({
    apiUrl,
    environment,
    sentryDsn: source.EXPO_PUBLIC_SENTRY_DSN || undefined,
    mobileAuthEnabled: readBoolean(source.EXPO_PUBLIC_MOBILE_AUTH_ENABLED),
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(' ');
    throw new Error(`Configuração mobile inválida: ${message}`);
  }

  return parsed.data;
}

export const mobileEnv = loadMobileEnv();
