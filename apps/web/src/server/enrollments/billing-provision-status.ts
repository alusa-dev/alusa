import {
  BillingMode,
  MatriculaBillingProvisionStatus,
  type Prisma,
} from '@prisma/client';

export function resolveInitialBillingProvisionStatus(input: {
  billingMode?: BillingMode | null;
  criarCobranca: boolean;
  gerarCobrancaTaxa: boolean;
  taxaIsenta: boolean;
  taxaMatricula: number;
  planoLiquido: number;
}): MatriculaBillingProvisionStatus {
  if (input.billingMode === BillingMode.SHARED_PLAN) {
    return MatriculaBillingProvisionStatus.NAO_APLICAVEL;
  }

  const needsTax =
    input.gerarCobrancaTaxa && !input.taxaIsenta && Number(input.taxaMatricula) > 0;
  const needsSubscription = input.criarCobranca && Number(input.planoLiquido) > 0;

  if (!needsTax && !needsSubscription) {
    return MatriculaBillingProvisionStatus.NAO_APLICAVEL;
  }

  return MatriculaBillingProvisionStatus.PENDENTE;
}

export function deriveBillingProvisionStatusFromSync(input: {
  requiresTax: boolean;
  taxaSyncSuccess: boolean | null;
  shouldCreateSubscription: boolean;
  subscriptionSyncSuccess: boolean | null;
  hasAsaasSubscriptionId: boolean;
}): MatriculaBillingProvisionStatus {
  if (!input.requiresTax && !input.shouldCreateSubscription) {
    return MatriculaBillingProvisionStatus.NAO_APLICAVEL;
  }

  const taxOk = !input.requiresTax || input.taxaSyncSuccess === true;
  const subscriptionOk =
    !input.shouldCreateSubscription ||
    input.subscriptionSyncSuccess === true ||
    input.hasAsaasSubscriptionId;

  if (taxOk && subscriptionOk) {
    return MatriculaBillingProvisionStatus.PROVISIONADO;
  }

  if (taxOk && input.shouldCreateSubscription && !subscriptionOk) {
    return MatriculaBillingProvisionStatus.PARCIAL;
  }

  if (!taxOk) {
    return MatriculaBillingProvisionStatus.FALHO;
  }

  return MatriculaBillingProvisionStatus.PARCIAL;
}

export function billingProvisionUpdate(
  status: MatriculaBillingProvisionStatus,
  error?: string | null,
): Prisma.MatriculaUpdateInput {
  return {
    billingProvisionStatus: status,
    billingProvisionError: error ?? null,
    billingProvisionAt: new Date(),
  };
}
