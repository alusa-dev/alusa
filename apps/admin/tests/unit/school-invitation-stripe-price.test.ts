import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ price: {} as Record<string, unknown>, retrieve: vi.fn() }));
vi.mock('@alusa/stripe', () => ({
  getStripeClient: () => ({ prices: { retrieve: mock.retrieve } }),
  parseStripeRuntimeConfig: () => ({ environment: 'TEST' }),
}));

describe('custom invitation recurring Price validation', () => {
  beforeEach(() => {
    mock.price = { active: true, livemode: false, type: 'recurring', recurring: { interval: 'month' }, currency: 'brl', unit_amount: 95000 };
    mock.retrieve.mockReset().mockImplementation(async () => mock.price);
  });

  it('accepts only a matching active monthly BRL Price in the configured Stripe mode', async () => {
    const { verifyInvitationStripePrice } = await import('../../features/school-invitations/stripe-price');
    await expect(verifyInvitationStripePrice({ priceId: 'price_custom_1', monthlyAmountCents: 95000 })).resolves.toEqual({ environment: 'TEST' });
    expect(mock.retrieve).toHaveBeenCalledWith('price_custom_1');
  });

  it.each([
    [{ active: false }, 95000],
    [{ type: 'one_time' }, 95000],
    [{ recurring: { interval: 'year' } }, 95000],
    [{ currency: 'usd' }, 95000],
    [{ unit_amount: 120000 }, 95000],
    [{ livemode: true }, 95000],
  ])('rejects a Price that does not match the commercial condition', async (overrides, amount) => {
    mock.price = { ...mock.price, ...overrides };
    const { verifyInvitationStripePrice, InvitationStripePriceError } = await import('../../features/school-invitations/stripe-price');
    await expect(verifyInvitationStripePrice({ priceId: 'price_custom_1', monthlyAmountCents: amount }))
      .rejects.toBeInstanceOf(InvitationStripePriceError);
  });
});
