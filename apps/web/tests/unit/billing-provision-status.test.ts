/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  deriveBillingProvisionStatusFromSync,
  resolveInitialBillingProvisionStatus,
} from '@/src/server/matriculas/billing-provision-status';
import { BillingMode, MatriculaBillingProvisionStatus } from '@prisma/client';

describe('billing-provision-status', () => {
  it('marca SHARED_PLAN como NAO_APLICAVEL', () => {
    expect(
      resolveInitialBillingProvisionStatus({
        billingMode: BillingMode.SHARED_PLAN,
        criarCobranca: true,
        gerarCobrancaTaxa: true,
        taxaIsenta: false,
        taxaMatricula: 100,
        planoLiquido: 500,
      }),
    ).toBe(MatriculaBillingProvisionStatus.NAO_APLICAVEL);
  });

  it('derivar PROVISIONADO quando taxa e assinatura OK', () => {
    expect(
      deriveBillingProvisionStatusFromSync({
        requiresTax: true,
        taxaSyncSuccess: true,
        shouldCreateSubscription: true,
        subscriptionSyncSuccess: true,
        hasAsaasSubscriptionId: true,
      }),
    ).toBe(MatriculaBillingProvisionStatus.PROVISIONADO);
  });

  it('derivar PARCIAL quando taxa OK e assinatura falhou', () => {
    expect(
      deriveBillingProvisionStatusFromSync({
        requiresTax: true,
        taxaSyncSuccess: true,
        shouldCreateSubscription: true,
        subscriptionSyncSuccess: false,
        hasAsaasSubscriptionId: false,
      }),
    ).toBe(MatriculaBillingProvisionStatus.PARCIAL);
  });
});
