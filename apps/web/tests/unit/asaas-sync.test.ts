import { describe, expect, it } from 'vitest';

import { formatFormaPagamentoLabel } from '@/lib/finance/asaas-sync';

describe('formatFormaPagamentoLabel', () => {
  it('normaliza cartão de crédito independentemente do código de origem', () => {
    expect(formatFormaPagamentoLabel('CREDIT_CARD')).toBe('Cartão de crédito');
    expect(formatFormaPagamentoLabel('CARTAO_CREDITO')).toBe('Cartão de crédito');
  });

  it('normaliza formas indefinidas sem exibir enum bruto', () => {
    expect(formatFormaPagamentoLabel('UNDEFINED')).toBe('A definir');
    expect(formatFormaPagamentoLabel('INDEFINIDO')).toBe('A definir');
  });

  it('retorna placeholder quando a forma não existe', () => {
    expect(formatFormaPagamentoLabel(null)).toBe('—');
    expect(formatFormaPagamentoLabel(undefined)).toBe('—');
    expect(formatFormaPagamentoLabel('')).toBe('—');
  });
});