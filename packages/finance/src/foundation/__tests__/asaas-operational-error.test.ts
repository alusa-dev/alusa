import { describe, expect, it } from 'vitest';

import { AsaasHttpError } from '@alusa/asaas';

import { classifyAsaasOperationalError } from '../asaas-operational-error';

describe('classifyAsaasOperationalError', () => {
  it('classifica credencial inválida de subconta', () => {
    const error = new AsaasHttpError('Unauthorized', 401, { errors: [] });

    const result = classifyAsaasOperationalError(error, 'subaccount');

    expect(result.category).toBe('invalid_subaccount_credentials');
    expect(result.retryable).toBe(false);
  });

  it('classifica 404 de myAccount como recurso não encontrado', () => {
    const error = new AsaasHttpError('Not Found', 404, { errors: [] });

    const result = classifyAsaasOperationalError(error, 'subaccount');

    expect(result.category).toBe('myaccount_not_found');
    expect(result.retryable).toBe(false);
  });

  it('classifica 429 de concorrência', () => {
    const error = new AsaasHttpError('Too Many Requests', 429, {
      errors: [{ description: 'You have exceeded the concurrent requests limit.' }],
    });

    const result = classifyAsaasOperationalError(error, 'subaccount');

    expect(result.category).toBe('rate_limit_concurrency');
    expect(result.retryable).toBe(true);
  });

  it('classifica 429 de quota', () => {
    const error = new AsaasHttpError('Too Many Requests', 429, {
      errors: [{ description: 'Quota exceeded for 12 hours.' }],
    });

    const result = classifyAsaasOperationalError(error, 'master');

    expect(result.category).toBe('rate_limit_quota');
    expect(result.retryable).toBe(true);
  });
});