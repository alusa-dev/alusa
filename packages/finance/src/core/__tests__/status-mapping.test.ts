import { describe, it, expect } from 'vitest';
import {
  mapAsaasToInternalStatus,
  mapAsaasToCobrancaStatus,
  mapAsaasToChargeStatus,
  canProgressChargeStatus,
  computeNextCobrancaStatus,
  computeLiquidacaoStatus,
} from '../status-mapping';

describe('Status Mapping - mapAsaasToInternalStatus', () => {
  it('deve mapear status PENDING', () => {
    expect(mapAsaasToInternalStatus('PENDING')).toBe('PENDING');
  });

  it('deve mapear status de pagamento para CONFIRMED', () => {
    expect(mapAsaasToInternalStatus('RECEIVED')).toBe('CONFIRMED');
    expect(mapAsaasToInternalStatus('CONFIRMED')).toBe('CONFIRMED');
    expect(mapAsaasToInternalStatus('RECEIVED_IN_CASH')).toBe('RECEIVED_IN_CASH');
  });

  it('deve mapear status OVERDUE', () => {
    expect(mapAsaasToInternalStatus('OVERDUE')).toBe('OVERDUE');
  });

  it('deve mapear status de estorno', () => {
    expect(mapAsaasToInternalStatus('REFUNDED')).toBe('REFUNDED');
    expect(mapAsaasToInternalStatus('REFUND_REQUESTED')).toBe('REFUNDED');
    expect(mapAsaasToInternalStatus('REFUND_IN_PROGRESS')).toBe('REFUNDED');
  });

  it('deve mapear status de chargeback', () => {
    expect(mapAsaasToInternalStatus('CHARGEBACK_REQUESTED')).toBe('CHARGEBACK');
    expect(mapAsaasToInternalStatus('CHARGEBACK_DISPUTE')).toBe('CHARGEBACK');
    expect(mapAsaasToInternalStatus('AWAITING_CHARGEBACK_REVERSAL')).toBe('CHARGEBACK');
  });

  it('deve mapear status de cancelamento', () => {
    expect(mapAsaasToInternalStatus('DELETED')).toBe('CANCELLED');
  });

  it('deve retornar PENDING para status desconhecido', () => {
    expect(mapAsaasToInternalStatus('UNKNOWN_STATUS')).toBe('PENDING');
  });
});

describe('Status Mapping - mapAsaasToCobrancaStatus', () => {
  it('deve mapear para status de Cobranca', () => {
    expect(mapAsaasToCobrancaStatus('PENDING')).toBe('PENDENTE');
    expect(mapAsaasToCobrancaStatus('RECEIVED')).toBe('PAGO');
    expect(mapAsaasToCobrancaStatus('CONFIRMED')).toBe('PAGO');
    expect(mapAsaasToCobrancaStatus('OVERDUE')).toBe('ATRASADO');
    expect(mapAsaasToCobrancaStatus('REFUNDED')).toBe('ESTORNADO');
    expect(mapAsaasToCobrancaStatus('DELETED')).toBe('CANCELADO');
  });

  it('deve mapear AWAITING_RISK_ANALYSIS para PENDENTE (via internal status)', () => {
    // AWAITING_RISK_ANALYSIS → PENDING interno → PENDENTE cobrança
    expect(mapAsaasToCobrancaStatus('AWAITING_RISK_ANALYSIS')).toBe('PENDENTE');
  });
});

describe('Status Mapping - mapAsaasToChargeStatus', () => {
  it('deve mapear para status de Charge', () => {
    expect(mapAsaasToChargeStatus('PENDING')).toBe('OPEN');
    expect(mapAsaasToChargeStatus('RECEIVED')).toBe('PAID');
    expect(mapAsaasToChargeStatus('CONFIRMED')).toBe('PAID');
    expect(mapAsaasToChargeStatus('OVERDUE')).toBe('OVERDUE');
    expect(mapAsaasToChargeStatus('REFUNDED')).toBe('REFUNDED');
    expect(mapAsaasToChargeStatus('DELETED')).toBe('CANCELED');
  });
});

describe('Status Mapping - canProgressChargeStatus', () => {
  describe('progressão permitida', () => {
    it('OPEN → PAID', () => {
      expect(canProgressChargeStatus('OPEN', 'PAID')).toBe(true);
    });

    it('OPEN → OVERDUE', () => {
      expect(canProgressChargeStatus('OPEN', 'OVERDUE')).toBe(true);
    });

    it('OVERDUE → PAID', () => {
      expect(canProgressChargeStatus('OVERDUE', 'PAID')).toBe(true);
    });

    it('PAID → REFUNDED', () => {
      expect(canProgressChargeStatus('PAID', 'REFUNDED')).toBe(true);
    });
  });

  describe('regressão bloqueada', () => {
    it('PAID → OPEN', () => {
      expect(canProgressChargeStatus('PAID', 'OPEN')).toBe(false);
    });

    it('PAID → OVERDUE', () => {
      expect(canProgressChargeStatus('PAID', 'OVERDUE')).toBe(false);
    });

    it('REFUNDED → PAID', () => {
      expect(canProgressChargeStatus('REFUNDED', 'PAID')).toBe(false);
    });

    it('CANCELED → qualquer status', () => {
      expect(canProgressChargeStatus('CANCELED', 'OPEN')).toBe(false);
      expect(canProgressChargeStatus('CANCELED', 'PAID')).toBe(false);
    });
  });

  describe('mesmo status', () => {
    it('OPEN → OPEN retorna true (mesma precedência permite)', () => {
      // canProgressChargeStatus usa >= então mesmo status é permitido
      expect(canProgressChargeStatus('OPEN', 'OPEN')).toBe(true);
    });

    it('PAID → PAID retorna true (mesma precedência permite)', () => {
      expect(canProgressChargeStatus('PAID', 'PAID')).toBe(true);
    });
  });
});

describe('Status Mapping - computeNextCobrancaStatus', () => {
  it('deve manter status se não houver mudança válida', () => {
    const result = computeNextCobrancaStatus('PAGO', 'PENDENTE');

    expect(result).toBe('PAGO');
  });

  it('deve atualizar status se progressão for válida', () => {
    const result = computeNextCobrancaStatus('PENDENTE', 'PAGO');

    expect(result).toBe('PAGO');
  });

  it('deve permitir progressão ATRASADO → PAGO', () => {
    const result = computeNextCobrancaStatus('ATRASADO', 'PAGO');

    expect(result).toBe('PAGO');
  });
});

describe('Status Mapping - computeLiquidacaoStatus', () => {
  it('deve retornar NAO_APLICAVEL para status não-pagamento', () => {
    expect(computeLiquidacaoStatus({ asaasStatus: 'PENDING', creditDate: null })).toBe('NAO_APLICAVEL');
    expect(computeLiquidacaoStatus({ asaasStatus: 'OVERDUE', creditDate: null })).toBe('NAO_APLICAVEL');
    expect(computeLiquidacaoStatus({ asaasStatus: 'DELETED', creditDate: null })).toBe('NAO_APLICAVEL');
  });

  it('deve retornar PENDENTE para pagamento sem creditDate', () => {
    expect(computeLiquidacaoStatus({ asaasStatus: 'RECEIVED', creditDate: null })).toBe('PENDENTE');
    expect(computeLiquidacaoStatus({ asaasStatus: 'CONFIRMED', creditDate: null })).toBe('PENDENTE');
  });

  it('deve retornar DISPONIVEL para RECEIVED_IN_CASH', () => {
    expect(computeLiquidacaoStatus({ asaasStatus: 'RECEIVED_IN_CASH', creditDate: null })).toBe('DISPONIVEL');
    expect(computeLiquidacaoStatus({ asaasStatus: 'RECEIVED_IN_CASH', creditDate: '2099-12-31' })).toBe('DISPONIVEL');
  });

  it('deve calcular DISPONIVEL quando creditDate <= hoje', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    expect(computeLiquidacaoStatus({ asaasStatus: 'RECEIVED', creditDate: yesterdayStr })).toBe('DISPONIVEL');
  });

  it('deve calcular PENDENTE quando creditDate > hoje', () => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const futureStr = nextMonth.toISOString().split('T')[0];

    expect(computeLiquidacaoStatus({ asaasStatus: 'RECEIVED', creditDate: futureStr })).toBe('PENDENTE');
  });
});
