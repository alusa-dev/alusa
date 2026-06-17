import { describe, expect, it } from 'vitest';

import {
  isExternalAsaasApiKeyHealthy,
  shouldShowExternalAsaasApiKeyModal,
} from '@/lib/external-asaas-api-key-health';

const externalAdmin = {
  role: 'ADMIN',
  financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
} as const;

describe('external-asaas-api-key-health', () => {
  it('considera saudavel quando onboarding concluido e api key conectada', () => {
    expect(
      isExternalAsaasApiKeyHealthy({
        ...externalAdmin,
        externalAsaasOnboardingStatus: 'READY',
        asaasApiKeyStatus: 'CONNECTED',
      }),
    ).toBe(true);

    expect(
      isExternalAsaasApiKeyHealthy({
        ...externalAdmin,
        externalAsaasOnboardingStatus: 'WEBHOOK_PENDING',
        asaasApiKeyStatus: 'CONNECTED',
      }),
    ).toBe(true);
  });

  it('nao considera saudavel na primeira configuracao ou falha', () => {
    expect(
      isExternalAsaasApiKeyHealthy({
        ...externalAdmin,
        externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
        asaasApiKeyStatus: 'MISSING',
      }),
    ).toBe(false);

    expect(
      isExternalAsaasApiKeyHealthy({
        ...externalAdmin,
        externalAsaasOnboardingStatus: 'FAILED',
        asaasApiKeyStatus: 'MISSING',
      }),
    ).toBe(false);
  });

  it('nao considera saudavel quando a chave deixa de funcionar no Asaas', () => {
    for (const apiKeyStatus of ['EXPIRED', 'DISABLED', 'DELETED', 'REVOKED', 'INVALID'] as const) {
      expect(
        isExternalAsaasApiKeyHealthy({
          ...externalAdmin,
          externalAsaasOnboardingStatus: 'READY',
          asaasApiKeyStatus: apiKeyStatus,
        }),
      ).toBe(false);
    }
  });

  it('abre modal persistente para admin/financeiro externo sem chave saudavel', () => {
    expect(
      shouldShowExternalAsaasApiKeyModal({
        ...externalAdmin,
        externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
        asaasApiKeyStatus: 'MISSING',
      }),
    ).toBe(true);

    expect(
      shouldShowExternalAsaasApiKeyModal({
        role: 'FINANCEIRO',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        externalAsaasOnboardingStatus: 'READY',
        asaasApiKeyStatus: 'EXPIRED',
      }),
    ).toBe(true);
  });

  it('nao abre modal quando chave esta saudavel ou fluxo nao se aplica', () => {
    expect(
      shouldShowExternalAsaasApiKeyModal({
        ...externalAdmin,
        externalAsaasOnboardingStatus: 'READY',
        asaasApiKeyStatus: 'CONNECTED',
      }),
    ).toBe(false);

    expect(
      shouldShowExternalAsaasApiKeyModal({
        role: 'USER',
        financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
        externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
        asaasApiKeyStatus: 'MISSING',
      }),
    ).toBe(false);

    expect(
      shouldShowExternalAsaasApiKeyModal({
        ...externalAdmin,
        financeIntegrationMode: 'WHITELABEL_BAAS',
        externalAsaasOnboardingStatus: 'NOT_STARTED',
        asaasApiKeyStatus: 'MISSING',
      }),
    ).toBe(false);
  });
});
