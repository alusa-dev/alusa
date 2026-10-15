import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getStripeClientMock, retrieveDefaultPaymentMethodMock } = vi.hoisted(() => ({
  getStripeClientMock: vi.fn(),
  retrieveDefaultPaymentMethodMock: vi.fn(),
}));

vi.mock('@alusa/stripe', () => ({
  getStripeClient: getStripeClientMock,
  retrieveStripeDefaultPaymentMethod: retrieveDefaultPaymentMethodMock,
}));

import { refreshPlatformBillingPaymentMethod } from './reconciliation';

describe('refreshPlatformBillingPaymentMethod', () => {
  const account = {
    id: 'billing-account-a',
    contaId: 'conta-a',
    environment: 'TEST',
    stripeCustomerId: 'cus_a',
    stripeSubscriptionId: 'sub_a',
    paymentMethodStatus: 'PRESENT',
    paymentMethodType: 'card',
    paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242',
    paymentMethodExpMonth: 1,
    paymentMethodExpYear: 2070,
  };
  const prisma = {
    platformBillingAccount: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.platformBillingAccount.findUnique.mockResolvedValue(account);
    prisma.platformBillingAccount.updateMany.mockResolvedValue({ count: 1 });
    getStripeClientMock.mockReturnValue({});
  });

  it('refreshes an existing card snapshot after a Stripe Portal return', async () => {
    retrieveDefaultPaymentMethodMock.mockResolvedValue({
      type: 'card', brand: 'visa', last4: '5556', expMonth: 12, expYear: 2033,
    });

    await expect(refreshPlatformBillingPaymentMethod({
      prisma: prisma as never,
      contaId: 'conta-a',
      environment: 'TEST',
      force: true,
    })).resolves.toBe(true);

    expect(retrieveDefaultPaymentMethodMock).toHaveBeenCalledWith({}, {
      customerId: 'cus_a',
      subscriptionId: 'sub_a',
    });
    expect(prisma.platformBillingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'billing-account-a',
        contaId: 'conta-a',
        environment: 'TEST',
        stripeCustomerId: 'cus_a',
        stripeSubscriptionId: 'sub_a',
      },
      data: expect.objectContaining({ paymentMethodLast4: '5556', paymentMethodExpYear: 2033 }),
    }));
  });

  it('keeps ordinary summary reads from retrieving Stripe when a card snapshot exists', async () => {
    await expect(refreshPlatformBillingPaymentMethod({
      prisma: prisma as never,
      contaId: 'conta-a',
      environment: 'TEST',
    })).resolves.toBe(false);

    expect(retrieveDefaultPaymentMethodMock).not.toHaveBeenCalled();
    expect(prisma.platformBillingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('treats a Stripe retrieval failure as best-effort and leaves the snapshot untouched', async () => {
    retrieveDefaultPaymentMethodMock.mockRejectedValue(new Error('Stripe unavailable'));

    await expect(refreshPlatformBillingPaymentMethod({
      prisma: prisma as never,
      contaId: 'conta-a',
      environment: 'TEST',
      force: true,
    })).resolves.toBe(false);

    expect(prisma.platformBillingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('does not write a snapshot if the Stripe association changed during the refresh', async () => {
    retrieveDefaultPaymentMethodMock.mockResolvedValue({
      type: 'card', brand: 'visa', last4: '5556', expMonth: 12, expYear: 2033,
    });
    prisma.platformBillingAccount.updateMany.mockImplementation(async ({ where }) => {
      const sameStripeAssociation = where.stripeCustomerId === 'cus_a' && where.stripeSubscriptionId === 'sub_a';
      return { count: sameStripeAssociation ? 0 : 1 };
    });

    await expect(refreshPlatformBillingPaymentMethod({
      prisma: prisma as never,
      contaId: 'conta-a',
      environment: 'TEST',
      force: true,
    })).resolves.toBe(false);

    expect(prisma.platformBillingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a' }),
    }));
  });
});
