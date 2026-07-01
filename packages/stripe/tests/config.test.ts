import { describe, expect, it } from 'vitest';
import { DEFAULT_STRIPE_API_VERSION, parseStripeRuntimeConfig, StripeIntegrationError } from '../src';

describe('@alusa/stripe config', () => {
  it('gera erro seguro quando secret está ausente', () => {
    expect(() => parseStripeRuntimeConfig({ STRIPE_ENVIRONMENT: 'TEST' })).toThrow(StripeIntegrationError);

    try {
      parseStripeRuntimeConfig({ STRIPE_ENVIRONMENT: 'TEST' });
    } catch (error) {
      expect(error).toBeInstanceOf(StripeIntegrationError);
      expect(JSON.stringify(error)).not.toContain('sk_');
    }
  });

  it('rejeita environment inválido', () => {
    expect(() =>
      parseStripeRuntimeConfig({
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ENVIRONMENT: 'SANDBOX',
      }),
    ).toThrow(StripeIntegrationError);
  });

  it('aceita configuração TEST', () => {
    const config = parseStripeRuntimeConfig({
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_ENVIRONMENT: 'TEST',
    });

    expect(config.environment).toBe('TEST');
    expect(config.apiVersion).toBe(DEFAULT_STRIPE_API_VERSION);
    expect(DEFAULT_STRIPE_API_VERSION).toBe('2026-06-24.dahlia');
  });

  it('permite fixar API version validada pelo package técnico', () => {
    expect(
      parseStripeRuntimeConfig({
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_ENVIRONMENT: 'TEST',
        STRIPE_API_VERSION: '2026-06-24.dahlia',
      }).apiVersion,
    ).toBe('2026-06-24.dahlia');
  });

  it('aceita configuração LIVE', () => {
    expect(
      parseStripeRuntimeConfig({
        STRIPE_SECRET_KEY: 'sk_live_123',
        STRIPE_ENVIRONMENT: 'LIVE',
      }).environment,
    ).toBe('LIVE');
  });

  it('não vaza secret no erro de ambiente incompatível', () => {
    const secret = 'sk_live_sensitive';

    try {
      parseStripeRuntimeConfig({
        STRIPE_SECRET_KEY: secret,
        STRIPE_ENVIRONMENT: 'TEST',
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
