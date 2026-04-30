import { describe, it, expect } from 'vitest';
import { PAYMENT_STATUSES } from '@alusa/shared';
import {
  resolveLiquidacaoStatus,
  isReceivedInCash,
  isAvailableInAsaas,
  getEstimatedAvailableDate,
} from '../liquidacao-resolver';

describe('resolveLiquidacaoStatus', () => {
  const today = new Date('2024-01-15T12:00:00Z');

  describe('status não-pago', () => {
    it('deve retornar NAO_APLICAVEL para PENDING', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.PENDING,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('NAO_APLICAVEL');
    });

    it('deve retornar NAO_APLICAVEL para OVERDUE', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.OVERDUE,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('NAO_APLICAVEL');
    });

    it('deve retornar NAO_APLICAVEL para REFUNDED', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.REFUNDED,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('NAO_APLICAVEL');
    });

    it('deve retornar NAO_APLICAVEL para CANCELLED', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CANCELLED,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('NAO_APLICAVEL');
    });

    it('deve retornar NAO_APLICAVEL para CHARGEBACK', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CHARGEBACK,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('NAO_APLICAVEL');
    });
  });

  describe('RECEIVED_IN_CASH', () => {
    it('deve retornar NAO_APLICAVEL (recebido fora do Asaas)', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.RECEIVED_IN_CASH,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('NAO_APLICAVEL');
    });
  });

  describe('CONFIRMED', () => {
    it('deve retornar PENDENTE quando creditDate no futuro', () => {
      const futureDate = new Date('2024-01-20T12:00:00Z');
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CONFIRMED,
        creditDate: futureDate,
        referenceDate: today,
      });
      expect(result).toBe('PENDENTE');
    });

    it('deve retornar DISPONIVEL quando creditDate é hoje', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CONFIRMED,
        creditDate: today,
        referenceDate: today,
      });
      expect(result).toBe('DISPONIVEL');
    });

    it('deve retornar DISPONIVEL quando creditDate é passado', () => {
      const pastDate = new Date('2024-01-10T12:00:00Z');
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CONFIRMED,
        creditDate: pastDate,
        referenceDate: today,
      });
      expect(result).toBe('DISPONIVEL');
    });

    it('deve retornar PENDENTE quando creditDate é null', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CONFIRMED,
        creditDate: null,
        referenceDate: today,
      });
      expect(result).toBe('PENDENTE');
    });

    it('deve aceitar creditDate como string ISO', () => {
      const result = resolveLiquidacaoStatus({
        internalStatus: PAYMENT_STATUSES.CONFIRMED,
        creditDate: '2024-01-10T12:00:00Z',
        referenceDate: today,
      });
      expect(result).toBe('DISPONIVEL');
    });
  });
});

describe('isReceivedInCash', () => {
  it('deve retornar true para RECEIVED_IN_CASH', () => {
    expect(isReceivedInCash(PAYMENT_STATUSES.RECEIVED_IN_CASH)).toBe(true);
  });

  it('deve retornar false para CONFIRMED', () => {
    expect(isReceivedInCash(PAYMENT_STATUSES.CONFIRMED)).toBe(false);
  });

  it('deve retornar false para outros status', () => {
    expect(isReceivedInCash(PAYMENT_STATUSES.PENDING)).toBe(false);
    expect(isReceivedInCash(PAYMENT_STATUSES.OVERDUE)).toBe(false);
  });
});

describe('isAvailableInAsaas', () => {
  it('deve retornar true para DISPONIVEL', () => {
    expect(isAvailableInAsaas('DISPONIVEL')).toBe(true);
  });

  it('deve retornar false para PENDENTE', () => {
    expect(isAvailableInAsaas('PENDENTE')).toBe(false);
  });

  it('deve retornar false para NAO_APLICAVEL', () => {
    expect(isAvailableInAsaas('NAO_APLICAVEL')).toBe(false);
  });
});

describe('getEstimatedAvailableDate', () => {
  it('deve retornar null para undefined', () => {
    expect(getEstimatedAvailableDate(undefined)).toBeNull();
  });

  it('deve retornar null para null', () => {
    expect(getEstimatedAvailableDate(null)).toBeNull();
  });

  it('deve retornar Date para Date input', () => {
    const date = new Date('2024-01-15');
    const result = getEstimatedAvailableDate(date);
    expect(result).toEqual(date);
  });

  it('deve converter string ISO para Date', () => {
    const result = getEstimatedAvailableDate('2024-01-15T12:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2024-01-15T12:00:00.000Z');
  });
});
