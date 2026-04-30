import crypto from 'crypto';
import type { BillingType } from '@alusa/asaas';
import type { FormaPagamento } from '@prisma/client';

/**
 * Gera um ID determinístico a partir de um prefix + seed (idempotência).
 * Usado para garantir que a mesma operação gera o mesmo ID.
 */
export function deriveDeterministicId(prefix: string, seed: string): string {
  const hash = crypto.createHash('sha256').update(`${prefix}:${seed}`).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

const BILLING_TO_FORMA: Record<BillingType, FormaPagamento> = {
  BOLETO: 'BOLETO',
  PIX: 'PIX',
  CREDIT_CARD: 'CARTAO_CREDITO',
  UNDEFINED: 'INDEFINIDO',
};

const FORMA_TO_BILLING: Record<FormaPagamento, BillingType> = {
  BOLETO: 'BOLETO',
  PIX: 'PIX',
  CARTAO_CREDITO: 'CREDIT_CARD',
  INDEFINIDO: 'UNDEFINED',
};

/** Converte BillingType (Asaas) → FormaPagamento (Prisma) */
export function toFormaPagamento(billingType: BillingType): FormaPagamento {
  return BILLING_TO_FORMA[billingType];
}

/** Converte FormaPagamento (Prisma) → BillingType (Asaas) */
export function toBillingType(formaPagamento: FormaPagamento): BillingType {
  return FORMA_TO_BILLING[formaPagamento];
}
