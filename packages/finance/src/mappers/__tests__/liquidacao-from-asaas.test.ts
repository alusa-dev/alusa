import { describe, it, expect } from 'vitest';
import { resolveLiquidacaoFromAsaasPayment } from '../liquidacao-from-asaas';

describe('resolveLiquidacaoFromAsaasPayment', () => {
  const today = new Date('2024-01-15T12:00:00Z');

  it('retorna NAO_APLICAVEL para PENDING', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({ asaasStatus: 'PENDING', referenceDate: today }),
    ).toBe('NAO_APLICAVEL');
  });

  it('retorna NAO_APLICAVEL para OVERDUE', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({ asaasStatus: 'OVERDUE', referenceDate: today }),
    ).toBe('NAO_APLICAVEL');
  });

  it('retorna PENDENTE para CONFIRMED sem creditDate', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({ asaasStatus: 'CONFIRMED', referenceDate: today }),
    ).toBe('PENDENTE');
  });

  it('retorna DISPONIVEL para CONFIRMED com creditDate hoje ou passado', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({
        asaasStatus: 'CONFIRMED',
        creditDate: '2024-01-10',
        referenceDate: today,
      }),
    ).toBe('DISPONIVEL');
  });

  it('retorna PENDENTE para CONFIRMED com creditDate futuro', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({
        asaasStatus: 'CONFIRMED',
        creditDate: '2024-01-20',
        referenceDate: today,
      }),
    ).toBe('PENDENTE');
  });

  it('trata RECEIVED como CONFIRMED para liquidação', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({
        asaasStatus: 'RECEIVED',
        creditDate: today,
        referenceDate: today,
      }),
    ).toBe('DISPONIVEL');
  });

  it('retorna DISPONIVEL para RECEIVED_IN_CASH', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({ asaasStatus: 'RECEIVED_IN_CASH', referenceDate: today }),
    ).toBe('DISPONIVEL');
  });

  it('retorna DISPONIVEL para billingType RECEIVED_IN_CASH', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({
        asaasStatus: 'PENDING',
        billingType: 'RECEIVED_IN_CASH',
        referenceDate: today,
      }),
    ).toBe('DISPONIVEL');
  });

  it('retorna DISPONIVEL para DUNNING_RECEIVED com creditDate', () => {
    expect(
      resolveLiquidacaoFromAsaasPayment({
        asaasStatus: 'DUNNING_RECEIVED',
        creditDate: today,
        referenceDate: today,
      }),
    ).toBe('DISPONIVEL');
  });
});
