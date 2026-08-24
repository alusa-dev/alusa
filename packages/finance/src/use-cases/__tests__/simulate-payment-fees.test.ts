import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  simulatePayment: vi.fn(),
}));

import { simulatePayment } from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import {
  simulatePaymentFees,
} from '../simulate-payment-fees';

const mockedLoadCredentials = vi.mocked(loadAsaasCredentials);
const mockedSimulatePayment = vi.mocked(simulatePayment);

describe('simulatePaymentFees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calcula o valor líquido da simulação à vista', async () => {
    mockedLoadCredentials.mockResolvedValue({ apiKey: '$aact_hmlg_test' } as never);
    mockedSimulatePayment.mockResolvedValue({
      value: 300,
      creditCard: {
        netValue: 290.54,
        feePercentage: 2.99,
        operationFee: 0.49,
        installment: { paymentValue: 300, paymentNetValue: 290.54 },
      },
    });

    const result = await simulatePaymentFees({
      contaId: 'conta-a',
      input: { value: 300, installmentCount: 1 },
    });

    expect(result).toEqual({
      success: true,
      data: {
        requestedValue: 300,
        chargeValue: 300,
        installmentCount: 1,
        netValue: 290.54,
        installmentValue: 300,
        installmentNetValue: 290.54,
        feeValue: 9.46,
        feePercentage: 2.99,
        operationFee: 0.49,
      },
    });
    expect(mockedSimulatePayment).toHaveBeenCalledWith({
      apiKey: '$aact_hmlg_test',
      value: 300,
      installmentCount: undefined,
      billingTypes: ['CREDIT_CARD'],
    });
  });

  it('mantém total e parcela retornados pelo Asaas em uma venda parcelada', async () => {
    mockedLoadCredentials.mockResolvedValue({ apiKey: '$aact_hmlg_test' } as never);
    mockedSimulatePayment.mockResolvedValue({
      value: 350,
      creditCard: {
        netValue: 339.02,
        feePercentage: 2.99,
        operationFee: 0.49,
        installment: { paymentValue: 29.17, paymentNetValue: 28.25 },
      },
    });

    const result = await simulatePaymentFees({
      contaId: 'conta-a',
      input: { value: 350, installmentCount: 12 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chargeValue).toBe(350);
      expect(result.data.netValue).toBe(339.02);
      expect(result.data.installmentValue).toBe(29.17);
      expect(result.data.installmentNetValue).toBe(28.25);
      expect(result.data.feeValue).toBe(10.98);
    }
    expect(mockedSimulatePayment).toHaveBeenCalledWith(expect.objectContaining({ installmentCount: 12 }));
  });

  it('retorna erro quando a conta não tem credencial Asaas', async () => {
    mockedLoadCredentials.mockResolvedValue(null);

    const result = await simulatePaymentFees({
      contaId: 'conta-sem-asaas',
      input: { value: 300, installmentCount: 1 },
    });

    expect(result).toEqual({ success: false, error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' });
    expect(mockedSimulatePayment).not.toHaveBeenCalled();
  });

});
