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
  grossUpPaymentValue,
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
      input: { value: 300, installmentCount: 1, passFeesToCustomer: false },
    });

    expect(result).toEqual({
      success: true,
      data: {
        requestedValue: 300,
        simulatedValue: 300,
        installmentCount: 1,
        passFeesToCustomer: false,
        paymentValue: 300,
        paymentNetValue: 290.54,
        feeValue: 9.46,
        feePercentage: 2.99,
        operationFee: 0.49,
      },
    });
    expect(mockedSimulatePayment).toHaveBeenCalledWith({
      apiKey: '$aact_hmlg_test',
      value: 300,
      installmentCount: 1,
      billingTypes: ['CREDIT_CARD'],
    });
  });

  it('faz uma segunda simulação quando o repasse de taxa está ativo', async () => {
    mockedLoadCredentials.mockResolvedValue({ apiKey: '$aact_hmlg_test' } as never);
    mockedSimulatePayment
      .mockResolvedValueOnce({
        value: 300,
        creditCard: {
          netValue: 290.54,
          feePercentage: 2.99,
          operationFee: 0.49,
          installment: { paymentValue: 300, paymentNetValue: 290.54 },
        },
      })
      .mockResolvedValueOnce({
        value: 309.75,
        creditCard: {
          netValue: 300,
          feePercentage: 2.99,
          operationFee: 0.49,
          installment: { paymentValue: 309.75, paymentNetValue: 300 },
        },
      });

    const result = await simulatePaymentFees({
      contaId: 'conta-a',
      input: { value: 300, installmentCount: 1, passFeesToCustomer: true },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.simulatedValue).toBe(309.75);
      expect(result.data.paymentNetValue).toBe(300);
      expect(result.data.feeValue).toBe(9.75);
    }
    expect(mockedSimulatePayment).toHaveBeenCalledTimes(2);
  });

  it('retorna erro quando a conta não tem credencial Asaas', async () => {
    mockedLoadCredentials.mockResolvedValue(null);

    const result = await simulatePaymentFees({
      contaId: 'conta-sem-asaas',
      input: { value: 300, installmentCount: 1, passFeesToCustomer: false },
    });

    expect(result).toEqual({ success: false, error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' });
    expect(mockedSimulatePayment).not.toHaveBeenCalled();
  });

  it('isola o gross-up e arredonda para centavos', () => {
    expect(grossUpPaymentValue({ netValue: 300, feePercentage: 2.99, operationFee: 0.49 })).toBe(309.75);
    expect(grossUpPaymentValue({ netValue: 100, feePercentage: 0, operationFee: 0.99 })).toBe(100.99);
  });
});
