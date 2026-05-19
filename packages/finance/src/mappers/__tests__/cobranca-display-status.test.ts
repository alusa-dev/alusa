import { describe, it, expect } from 'vitest';
import { resolveCobrancaDisplayStatus } from '../cobranca-display-status';

describe('resolveCobrancaDisplayStatus', () => {
  it('indica aguardando crédito quando PAGO com liquidação pendente', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'PAGO',
      liquidacaoStatus: 'PENDENTE',
      asaasStatus: 'CONFIRMED',
    });
    expect(result.hint).toContain('aguardando crédito');
  });

  it('indica processando para análise de risco', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'PROCESSANDO',
      asaasStatus: 'AWAITING_RISK_ANALYSIS',
    });
    expect(result.label).toBe('Processando');
  });
});
