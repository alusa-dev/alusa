import { describe, expect, it } from 'vitest';

import { resolveChargeInvoiceEmissionPath } from '../charge-invoice-emission-path';

describe('resolveChargeInvoiceEmissionPath', () => {
  it.each(['TAXA_MATRICULA', 'AVULSA', 'EXTRA', 'PARCELADA'])(
    'mantém %s no caminho local mesmo com assinatura acadêmica configurada',
    (tipo) => {
      expect(
        resolveChargeInvoiceEmissionPath({
          charge: { cobranca: { tipo } },
          subscription: {
            asaasSubscriptionId: 'sub-academic-1',
            asaasInvoiceSettingsConfigured: true,
          },
          asaasPayment: { subscription: null },
        }),
      ).toBe('ALUSA_LOCAL');
    },
  );

  it('usa emissão nativa para mensalidade quando o pagamento pertence à assinatura acadêmica', () => {
    expect(
      resolveChargeInvoiceEmissionPath({
        charge: { cobranca: { tipo: 'MENSALIDADE' } },
        subscription: {
          asaasSubscriptionId: 'sub-academic-1',
          asaasInvoiceSettingsConfigured: true,
        },
        asaasPayment: { subscription: 'sub-academic-1' },
      }),
    ).toBe('ASAAS_SUBSCRIPTION_NATIVE');
  });

  it('não usa emissão nativa quando o sinal do pagamento aponta outra assinatura', () => {
    expect(
      resolveChargeInvoiceEmissionPath({
        charge: { cobranca: { tipo: 'RECORRENTE' } },
        subscription: {
          asaasSubscriptionId: 'sub-academic-1',
          asaasInvoiceSettingsConfigured: true,
        },
        asaasPayment: { subscription: 'sub-other' },
      }),
    ).toBe('ALUSA_LOCAL');
  });

  it('usa emissão nativa para assinatura standalone configurada quando o pagamento pertence a ela', () => {
    expect(
      resolveChargeInvoiceEmissionPath({
        charge: {
          standaloneSubscriptionId: 'standalone-sub-1',
          standaloneSubscription: {
            asaasSubscriptionId: 'sub-standalone-1',
            asaasInvoiceSettingsConfigured: true,
          },
          cobranca: null,
        },
        asaasPayment: { subscription: 'sub-standalone-1' },
      }),
    ).toBe('ASAAS_SUBSCRIPTION_NATIVE');
  });

  it('mantém cobrança standalone avulsa no caminho local', () => {
    expect(
      resolveChargeInvoiceEmissionPath({
        charge: {
          standaloneSubscriptionId: null,
          standaloneSubscription: null,
          cobranca: null,
        },
      }),
    ).toBe('ALUSA_LOCAL');
  });
});
