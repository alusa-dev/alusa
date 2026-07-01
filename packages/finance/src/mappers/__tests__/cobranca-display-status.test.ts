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
    expect(result.label).toBe('Em análise');
  });

  it('mantém cancelada quando o snapshot do Asaas ainda parece aberto', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'CANCELADO',
      asaasStatus: 'PENDING',
    });

    expect(result.label).toBe('Cancelada');
    expect(result.status).toBe('CANCELADO');
    expect(result.source).toBe('local');
  });

  it('mantém paga quando o snapshot do Asaas ainda parece pendente', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'PAGO',
      asaasStatus: 'PENDING',
      liquidacaoStatus: 'PENDENTE',
    });

    expect(result.label).toBe('Confirmada');
    expect(result.status).toBe('CONFIRMED');
    expect(result.source).toBe('liquidacao');
  });

  it('mantém estornada quando o snapshot do Asaas ainda parece aberto', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'ESTORNADO',
      asaasStatus: 'OVERDUE',
    });

    expect(result.label).toBe('Estornada');
    expect(result.status).toBe('ESTORNADO');
    expect(result.source).toBe('local');
  });

  it('permite que estorno do Asaas supere cobrança local paga', () => {
    const result = resolveCobrancaDisplayStatus({
      status: 'PAGO',
      asaasStatus: 'REFUNDED',
    });

    expect(result.label).toBe('Estornada');
    expect(result.status).toBe('REFUNDED');
    expect(result.source).toBe('asaas');
  });
});
