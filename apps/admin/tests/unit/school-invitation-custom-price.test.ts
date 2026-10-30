import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  productCreate: vi.fn(),
  priceCreate: vi.fn(),
}));

vi.mock('@alusa/stripe', () => ({
  getStripeClient: () => ({ products: { create: mocks.productCreate }, prices: { create: mocks.priceCreate } }),
  parseStripeRuntimeConfig: () => ({ environment: 'TEST' }),
}));

describe('custom invitation tiered Price creation', () => {
  beforeEach(() => {
    mocks.productCreate.mockReset().mockResolvedValue({ id: 'prod_custom_v1' });
    mocks.priceCreate.mockReset().mockResolvedValue({ id: 'price_custom_v1' });
  });

  it('creates a monthly graduated Price with base amount and per-student overage using stable idempotency keys', async () => {
    const { createCustomInvitationPrice } = await import('../../features/school-invitations/custom-price');
    const terms = {
      invitationId: 'invitation_123', version: 3, schoolName: 'Escola Alusa', studentCount: 40,
      baseMonthlyAmountCents: 20_000, includedStudentCount: 25, monthlyPerStudentOverageCents: 250,
    };

    await expect(createCustomInvitationPrice(terms)).resolves.toEqual({
      stripeProductId: 'prod_custom_v1', stripePriceId: 'price_custom_v1', monthlyAmountCents: 23_750,
    });
    expect(mocks.productCreate).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ invitationId: 'invitation_123', conditionVersion: '3' }) }), { idempotencyKey: 'alusa:school-invitation:invitation_123:condition:3:product' });
    expect(mocks.priceCreate).toHaveBeenCalledWith(expect.objectContaining({
      product: 'prod_custom_v1', currency: 'brl', billing_scheme: 'tiered', tiers_mode: 'graduated',
      recurring: { interval: 'month', usage_type: 'licensed' },
      tiers: [{ up_to: 25, flat_amount: 20_000 }, { up_to: 'inf', unit_amount: 250 }],
      metadata: expect.objectContaining({ acceptedEstimateMonthlyAmountCents: '23750' }),
    }), { idempotencyKey: 'alusa:school-invitation:invitation_123:condition:3:price:20000:25:250' });
  });

  it('rejects invalid terms before making Stripe calls', async () => {
    const { createCustomInvitationPrice, InvitationStripePriceError } = await import('../../features/school-invitations/custom-price');
    await expect(createCustomInvitationPrice({
      invitationId: 'invitation_123', version: 1, schoolName: 'Escola Alusa', studentCount: 30,
      baseMonthlyAmountCents: 20_000, includedStudentCount: 25, monthlyPerStudentOverageCents: 0,
    })).rejects.toBeInstanceOf(InvitationStripePriceError);
    expect(mocks.productCreate).not.toHaveBeenCalled();
    expect(mocks.priceCreate).not.toHaveBeenCalled();
  });

  it('reuses the same Product and Price idempotency keys after an ambiguous Price timeout', async () => {
    mocks.priceCreate.mockRejectedValueOnce(new Error('provider timeout')).mockResolvedValueOnce({ id: 'price_custom_v1' });
    const { createCustomInvitationPrice } = await import('../../features/school-invitations/custom-price');
    const terms = {
      invitationId: 'invitation_retry', version: 2, schoolName: 'Escola Alusa', studentCount: 40,
      baseMonthlyAmountCents: 20_000, includedStudentCount: 25, monthlyPerStudentOverageCents: 250,
    };

    await expect(createCustomInvitationPrice(terms)).rejects.toMatchObject({ code: 'PLATFORM_PRICE_UNAVAILABLE' });
    await expect(createCustomInvitationPrice(terms)).resolves.toMatchObject({
      stripeProductId: 'prod_custom_v1', stripePriceId: 'price_custom_v1', monthlyAmountCents: 23_750,
    });

    expect(mocks.productCreate).toHaveBeenCalledTimes(2);
    expect(mocks.productCreate.mock.calls[0]?.[1]).toEqual(mocks.productCreate.mock.calls[1]?.[1]);
    expect(mocks.priceCreate).toHaveBeenCalledTimes(2);
    expect(mocks.priceCreate.mock.calls[0]?.[1]).toEqual(mocks.priceCreate.mock.calls[1]?.[1]);
  });
});
