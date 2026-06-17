import { describe, it, expect } from 'vitest';
import { resolveCobrancaDisplayStatus } from '../cobranca-display-status';

describe('resolveCobrancaDisplayStatus', () => {
  it('indica aguardando crédito quando PAGO com liquidação pendente', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'PAGO',
      liquidacaoStatus: 'PENDENTE',
      asaasStatus: 'CONFIRMED',
    });
    expect(result.label).toBe('Confirmada');
    expect(result.hint).toContain('saldo ainda não disponibilizado');
  });

  it('indica processando para análise de risco', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'PROCESSANDO',
      asaasStatus: 'AWAITING_RISK_ANALYSIS',
    });
    expect(result.label).toBe('Em analise');
  });
});
