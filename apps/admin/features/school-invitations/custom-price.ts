import { getStripeClient, parseStripeRuntimeConfig } from '@alusa/stripe';
import { calculateCustomInvitationMonthlyAmountCents } from '@alusa/platform-billing';

export type CustomInvitationPriceInput = {
  invitationId: string;
  version: number;
  schoolName: string;
  studentCount: number;
  baseMonthlyAmountCents: number;
  includedStudentCount: number;
  monthlyPerStudentOverageCents: number;
};

export class InvitationStripePriceError extends Error {
  constructor(readonly code: 'PLATFORM_PRICE_INVALID' | 'PLATFORM_PRICE_UNAVAILABLE', message: string) {
    super(message);
  }
}

export async function createCustomInvitationPrice(input: CustomInvitationPriceInput) {
  const monthlyAmountCents = calculateCustomInvitationMonthlyAmountCents(input);
  if (!monthlyAmountCents || input.monthlyPerStudentOverageCents < 1 || !Number.isInteger(input.version) || input.version < 1) {
    throw new InvitationStripePriceError('PLATFORM_PRICE_INVALID', 'Informe os valores da condição personalizada para calcular a mensalidade.');
  }

  try {
    parseStripeRuntimeConfig(process.env);
    const client = getStripeClient(process.env);
    const keyPrefix = `alusa:school-invitation:${input.invitationId}:condition:${input.version}`;
    const product = await client.products.create({
      name: `Alusa · ${input.schoolName.slice(0, 120)} · Condição v${input.version}`,
      description: `Plano escolar personalizado · ${input.includedStudentCount} alunos incluídos · excedente mensal por aluno`,
      metadata: { invitationId: input.invitationId, conditionVersion: String(input.version), billingContext: 'school_invitation' },
    }, { idempotencyKey: `${keyPrefix}:product` });
    const price = await client.prices.create({
      product: product.id,
      currency: 'brl',
      billing_scheme: 'tiered',
      tiers_mode: 'graduated',
      tiers: [
        { up_to: input.includedStudentCount, flat_amount: input.baseMonthlyAmountCents },
        { up_to: 'inf', unit_amount: input.monthlyPerStudentOverageCents },
      ],
      recurring: { interval: 'month', usage_type: 'licensed' },
      metadata: {
        invitationId: input.invitationId,
        conditionVersion: String(input.version),
        includedStudentCount: String(input.includedStudentCount),
        baseMonthlyAmountCents: String(input.baseMonthlyAmountCents),
        monthlyPerStudentOverageCents: String(input.monthlyPerStudentOverageCents),
        acceptedEstimateMonthlyAmountCents: String(monthlyAmountCents),
      },
    }, { idempotencyKey: `${keyPrefix}:price:${input.baseMonthlyAmountCents}:${input.includedStudentCount}:${input.monthlyPerStudentOverageCents}` });
    return { stripeProductId: product.id, stripePriceId: price.id, monthlyAmountCents };
  } catch (error) {
    if (error instanceof InvitationStripePriceError) throw error;
    throw new InvitationStripePriceError('PLATFORM_PRICE_UNAVAILABLE', 'Não foi possível criar o Price da condição personalizada no Stripe. Tente novamente; a chave de idempotência preserva a mesma versão.');
  }
}
