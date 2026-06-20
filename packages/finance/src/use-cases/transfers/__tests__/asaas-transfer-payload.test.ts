import { describe, expect, it } from 'vitest';

import {
  estimateTransferDebitAmount,
  estimateTransferFee,
  isValidPixPhoneKey,
  normalizePixKeyForAsaas,
  normalizeWithdrawDestinationForAsaas,
  requiresOwnerBirthDate,
  resolveTransferOperationFromAsaas,
} from '../asaas-transfer-payload';

describe('asaas-transfer-payload', () => {
  it('normaliza CPF/CNPJ sem pontuação', () => {
    expect(normalizePixKeyForAsaas('123.456.789-09', 'CPF')).toBe('12345678909');
    expect(normalizePixKeyForAsaas('12.345.678/0001-95', 'CNPJ')).toBe('12345678000195');
  });

  it('normaliza telefone Pix para 11 dígitos com DDD', () => {
    expect(normalizePixKeyForAsaas('(47) 99999-9999', 'PHONE')).toBe('47999999999');
    expect(normalizePixKeyForAsaas('+55 47 99999-9999', 'PHONE')).toBe('47999999999');
    expect(isValidPixPhoneKey('+55 47 99999-9999')).toBe(true);
    expect(isValidPixPhoneKey('4799999999')).toBe(false);
  });

  it('normaliza email e EVP', () => {
    expect(normalizePixKeyForAsaas('  Foo@Bar.COM ', 'EMAIL')).toBe('foo@bar.com');
    expect(normalizePixKeyForAsaas('A1B2C3D4-E5F6-7890-ABCD-EF1234567890', 'EVP')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
  });

  it('normaliza destino bancário', () => {
    const normalized = normalizeWithdrawDestinationForAsaas({
      type: 'BANK_ACCOUNT',
      bank: { code: '237' },
      ownerName: '  Maria   Silva ',
      cpfCnpj: '123.456.789-09',
      agency: '1263',
      account: '9999991',
      accountDigit: '1',
    });

    expect(normalized).toMatchObject({
      cpfCnpj: '12345678909',
      agency: '1263',
      account: '9999991',
      accountDigit: '1',
      ownerName: 'Maria Silva',
    });
  });

  it('exige ownerBirthDate para favorecido PF diferente do tenant', () => {
    expect(requiresOwnerBirthDate('11144477735', '12345678909')).toBe(true);
    expect(requiresOwnerBirthDate('12345678909', '123.456.789-09')).toBe(false);
    expect(requiresOwnerBirthDate('12345678000195', '12345678909')).toBe(true);
    expect(requiresOwnerBirthDate('12345678000195', '12345678000195')).toBe(false);
  });

  it('estima débito com taxa', () => {
    const fees = {
      monthlyTransfersWithoutFee: 0,
      pix: { feeValue: 1.99, discountValue: null, expirationDate: null, consideredInMonthlyTransfersWithoutFee: false },
      ted: { feeValue: 5, consideredInMonthlyTransfersWithoutFee: false },
    };

    expect(estimateTransferFee(fees, 'PIX')).toBe(1.99);
    expect(estimateTransferDebitAmount(100, fees, 'PIX')).toBe(101.99);
  });

  it('resolve operação oficial do Asaas', () => {
    expect(resolveTransferOperationFromAsaas('PIX')).toBe('PIX');
    expect(resolveTransferOperationFromAsaas('TED')).toBe('TED');
    expect(resolveTransferOperationFromAsaas(undefined)).toBe('TED');
  });
});
