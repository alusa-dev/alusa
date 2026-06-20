import type { TipoCobranca } from '@prisma/client';

export type ChargeInvoiceEmissionPath = 'ALUSA_LOCAL' | 'ASAAS_SUBSCRIPTION_NATIVE';

type SubscriptionInfo = {
  asaasSubscriptionId?: string | null;
  asaasInvoiceSettingsConfigured?: boolean | null;
};

export type ResolveChargeInvoiceEmissionPathInput = {
  charge: {
    standaloneSubscriptionId?: string | null;
    standaloneSubscription?: SubscriptionInfo | null;
    cobranca?: { tipo?: TipoCobranca | string | null } | null;
  };
  subscription?: SubscriptionInfo | null;
  asaasPayment?: { subscription?: string | null } | null;
};

const ALWAYS_LOCAL_COBRANCA_TYPES = new Set<string>([
  'TAXA_MATRICULA',
  'AVULSA',
  'EXTRA',
  'PARCELADA',
]);

const NATIVE_ACADEMIC_COBRANCA_TYPES = new Set<string>(['MENSALIDADE', 'RECORRENTE']);

function hasConfiguredNativeSettings(subscription?: SubscriptionInfo | null): boolean {
  return Boolean(subscription?.asaasInvoiceSettingsConfigured);
}

function paymentMatchesSubscription(
  paymentSubscription: string | null | undefined,
  subscription?: SubscriptionInfo | null,
): boolean {
  const normalizedPaymentSubscription = paymentSubscription?.trim();
  if (!normalizedPaymentSubscription) return true;

  const normalizedExpectedSubscription = subscription?.asaasSubscriptionId?.trim();
  return Boolean(normalizedExpectedSubscription && normalizedExpectedSubscription === normalizedPaymentSubscription);
}

export function resolveChargeInvoiceEmissionPath(
  input: ResolveChargeInvoiceEmissionPathInput,
): ChargeInvoiceEmissionPath {
  const cobrancaTipo = input.charge.cobranca?.tipo ?? null;
  const paymentSubscription = input.asaasPayment?.subscription ?? null;

  if (cobrancaTipo && ALWAYS_LOCAL_COBRANCA_TYPES.has(cobrancaTipo)) {
    return 'ALUSA_LOCAL';
  }

  if (input.charge.standaloneSubscriptionId && hasConfiguredNativeSettings(input.charge.standaloneSubscription)) {
    return paymentMatchesSubscription(paymentSubscription, input.charge.standaloneSubscription)
      ? 'ASAAS_SUBSCRIPTION_NATIVE'
      : 'ALUSA_LOCAL';
  }

  if (
    cobrancaTipo &&
    NATIVE_ACADEMIC_COBRANCA_TYPES.has(cobrancaTipo) &&
    hasConfiguredNativeSettings(input.subscription)
  ) {
    return paymentMatchesSubscription(paymentSubscription, input.subscription)
      ? 'ASAAS_SUBSCRIPTION_NATIVE'
      : 'ALUSA_LOCAL';
  }

  return 'ALUSA_LOCAL';
}
