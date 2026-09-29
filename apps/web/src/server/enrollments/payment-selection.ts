import { FormaPagamento } from '@prisma/client';
import type { AsaasBillingType } from '@alusa/finance';

import { mapFormaPagamentoToBillingType } from './recurring-billing';

function hasValue(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.trim().length > 0;
}

export function normalizeWizardFormaPagamento(raw: unknown): FormaPagamento | undefined {
  if (!hasValue(raw)) return undefined;

  const normalized = raw.trim().toUpperCase();
  const mapping: Record<string, FormaPagamento> = {
    CARTAO: FormaPagamento.CARTAO_CREDITO,
    CARTAO_CREDITO: FormaPagamento.CARTAO_CREDITO,
    PIX: FormaPagamento.PIX,
    BOLETO: FormaPagamento.BOLETO,
    DINHEIRO: FormaPagamento.INDEFINIDO,
    INDEFINIDO: FormaPagamento.INDEFINIDO,
  };

  return mapping[normalized];
}

export function resolveWizardPaymentSelection(input: {
  formaPagamento: unknown;
  formaPagamentoTaxa?: unknown;
}) {
  const formaPagamento = normalizeWizardFormaPagamento(input.formaPagamento);
  const formaPagamentoTaxaExplicit = normalizeWizardFormaPagamento(input.formaPagamentoTaxa);
  const formaPagamentoTaxa = hasValue(input.formaPagamentoTaxa)
    ? formaPagamentoTaxaExplicit
    : formaPagamento;

  return {
    formaPagamento,
    formaPagamentoTaxa,
    billingType: mapFormaPagamentoToBillingType(formaPagamento),
    billingTypeTaxa: mapFormaPagamentoToBillingType(formaPagamentoTaxa),
    invalidFormaPagamento: hasValue(input.formaPagamento) && !formaPagamento,
    invalidFormaPagamentoTaxa: hasValue(input.formaPagamentoTaxa) && !formaPagamentoTaxaExplicit,
  };
}

export function isSupportedAsaasBillingType(
  billingType: AsaasBillingType | null | undefined,
): billingType is Exclude<AsaasBillingType, 'UNDEFINED'> {
  return billingType === 'BOLETO' || billingType === 'PIX' || billingType === 'CREDIT_CARD';
}
