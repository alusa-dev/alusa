import { loadMobileEnv } from './env';

describe('loadMobileEnv', () => {
  it('valida ambiente completo', () => {
    expect(
      loadMobileEnv({
        EXPO_PUBLIC_API_URL: 'https://app.alusa.test',
        EXPO_PUBLIC_ENVIRONMENT: 'staging',
        EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        EXPO_PUBLIC_MOBILE_AUTH_ENABLED: 'true',
      }),
    ).toEqual({
      apiUrl: 'https://app.alusa.test',
      environment: 'staging',
      sentryDsn: 'https://public@example.ingest.sentry.io/1',
      mobileAuthEnabled: true,
    });
  });

  it('rejeita URL inválida', () => {
    expect(() => loadMobileEnv({ EXPO_PUBLIC_API_URL: 'alusa' })).toThrow('URL válida');
  });

  it('usa fallback local em desenvolvimento', () => {
    expect(loadMobileEnv({ NODE_ENV: 'development' }).apiUrl).toBe('http://localhost:3000');
  });

  it('exige API URL em produção', () => {
    expect(() => loadMobileEnv({ NODE_ENV: 'production' })).toThrow('Configuração mobile inválida');
  });

  it('permite Sentry ausente', () => {
    expect(
      loadMobileEnv({
        EXPO_PUBLIC_API_URL: 'http://localhost:3000',
        EXPO_PUBLIC_ENVIRONMENT: 'development',
      }).sentryDsn,
    ).toBeUndefined();
  });
});
