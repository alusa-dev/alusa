import { describe, expect, it } from 'vitest';

import {
  AsaasBaseUrlError,
  normalizeAndValidateAsaasBaseUrl,
  type AsaasEnvironment,
} from './asaasBaseUrl';

function expectError(input: string, env: AsaasEnvironment, code: AsaasBaseUrlError['code']) {
  try {
    normalizeAndValidateAsaasBaseUrl(input, env);
    throw new Error('expected to throw');
  } catch (e) {
    expect(e).toBeInstanceOf(AsaasBaseUrlError);
    expect((e as AsaasBaseUrlError).code).toBe(code);
  }
}

describe('asaasBaseUrl', () => {
  it('normaliza para terminar com /v3/', () => {
    expect(normalizeAndValidateAsaasBaseUrl('https://api-sandbox.asaas.com/v3', 'sandbox')).toBe(
      'https://api-sandbox.asaas.com/v3/',
    );
  });

  it('rejeita protocolo não-https', () => {
    expectError('http://api-sandbox.asaas.com/v3', 'sandbox', 'ASAAS_BASE_URL_PROTOCOL_INVALID');
  });

  it('rejeita path diferente de /v3', () => {
    expectError('https://api-sandbox.asaas.com/v3/payments', 'sandbox', 'ASAAS_BASE_URL_PATH_INVALID');
  });

  it('rejeita query/hash', () => {
    expectError('https://api-sandbox.asaas.com/v3/?x=1', 'sandbox', 'ASAAS_BASE_URL_INVALID');
    expectError('https://api-sandbox.asaas.com/v3/#hash', 'sandbox', 'ASAAS_BASE_URL_INVALID');
  });

  it('rejeita mismatch de ambiente quando hostname é oficial', () => {
    expectError('https://api-sandbox.asaas.com/v3', 'production', 'ASAAS_BASE_URL_ENV_MISMATCH');
    expectError('https://api.asaas.com/v3', 'sandbox', 'ASAAS_BASE_URL_ENV_MISMATCH');
  });
});
