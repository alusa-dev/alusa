import type { CustomerPayerType, Prisma } from '@prisma/client';

/** Resolve financial identity without treating its original educational role as ownership. */
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
