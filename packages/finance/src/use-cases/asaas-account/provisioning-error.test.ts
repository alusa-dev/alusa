import { describe, expect, it } from 'vitest';

import { AsaasHttpError } from '@alusa/asaas';

import {
  ASAAS_EMAIL_IN_USE_CODE,
  ASAAS_EMAIL_IN_USE_PREFIX,
  classifyAsaasProvisioningError,
} from './provisioning-error';

describe('classifyAsaasProvisioningError', () => {
  it('classifica e-mail duplicado como correção manual e não repetível', () => {
    const error = new AsaasHttpError('HTTP 400', 400, {
      errors: [{ code: 'invalid_object', description: 'O email lucas@example.com já está em uso.' }],
    });

    const result = classifyAsaasProvisioningError(error);

    expect(result).toMatchObject({
      code: ASAAS_EMAIL_IN_USE_CODE,
      retryable: false,
      storedMessage: `${ASAAS_EMAIL_IN_USE_PREFIX}Este e-mail já está em uso no Asaas. Informe outro e-mail para a subconta ou fale com o suporte da Alusa.`,
    });
    expect(result?.storedMessage).not.toContain('lucas@example.com');
  });

  it('não classifica erros temporários como conflito de e-mail', () => {
    expect(classifyAsaasProvisioningError(new AsaasHttpError('HTTP 503', 503))).toBeNull();
    expect(classifyAsaasProvisioningError(new AsaasHttpError('HTTP 400', 400, {
      errors: [{ code: 'invalid_object', description: 'CNPJ inválido.' }],
    }))).toBeNull();
  });
});
