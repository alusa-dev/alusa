import { describe, expect, it } from 'vitest';
import { MatriculaBillingProvisionStatus } from '@prisma/client';
import { deriveDeferredEnrollmentFeeProvisionStatus } from './billing-provision-status';

describe('deriveDeferredEnrollmentFeeProvisionStatus', () => {
  it('mantém a assinatura pendente quando a taxa foi sincronizada', () => {
    expect(deriveDeferredEnrollmentFeeProvisionStatus({
      requiresTax: true,
      taxaSyncSuccess: true,
    })).toBe(MatriculaBillingProvisionStatus.PENDENTE);
  });

  it.each([false, null])('mantém a falha de taxa retryable quando sync retorna %s', (taxaSyncSuccess) => {
    expect(deriveDeferredEnrollmentFeeProvisionStatus({
      requiresTax: true,
      taxaSyncSuccess,
    })).toBe(MatriculaBillingProvisionStatus.FALHO);
  });
});
