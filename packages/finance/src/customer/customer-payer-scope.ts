import type { CustomerPayerType, Prisma } from '@prisma/client';

/** Resolve the financial identity linked to an educational payer role. */
export function customerPayerWhere(
  contaId: string,
  payerType: CustomerPayerType,
  payerId: string | Prisma.StringFilter,
): Prisma.CustomerWhereInput {
  return {
    contaId,
    OR: [
      { payerType, payerId },
      { payerLinks: { some: { contaId, payerType, payerId } } },
    ],
  };
}
