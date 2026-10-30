import { getStripeClient, parseStripeRuntimeConfig } from '@alusa/stripe';

export class InvitationStripePriceError extends Error {
  constructor(readonly code: 'PLATFORM_PRICE_INVALID' | 'PLATFORM_PRICE_UNAVAILABLE', message: string) {
    super(message);
  }
}

/** Verify the operator-supplied Price before offering it to a school. */
export async function verifyInvitationStripePrice(input: { priceId: string; monthlyAmountCents: number }) {
  let environment: 'TEST' | 'LIVE';
  try {
    environment = parseStripeRuntimeConfig(process.env).environment;
  } catch {
    throw new InvitationStripePriceError('PLATFORM_PRICE_UNAVAILABLE', 'Stripe não está configurado para validar a condição personalizada.');
  }

  let price;
  try {
    price = await getStripeClient(process.env).prices.retrieve(input.priceId);
  } catch {
    throw new InvitationStripePriceError('PLATFORM_PRICE_UNAVAILABLE', 'Não foi possível consultar o Stripe para confirmar esse Price.');
  }

  if (!price.active || price.livemode !== (environment === 'LIVE') || price.type !== 'recurring' ||
    price.recurring?.interval !== 'month' || price.currency !== 'brl' || price.unit_amount !== input.monthlyAmountCents) {
    throw new InvitationStripePriceError('PLATFORM_PRICE_INVALID', 'O Price deve estar ativo, ser mensal recorrente em BRL e corresponder ao valor informado.');
  }
  return { environment };
}
