import { describe, it, expect } from 'vitest';
import {
  isTerminalCobrancaStatus,
  isTerminalChargeStatus,
  TERMINAL_COBRANCA_STATUSES,
  TERMINAL_CHARGE_STATUSES,
} from '../terminal-statuses';

describe('isTerminalCobrancaStatus', () => {
  it('CANCELADO é terminal', () => {
    expect(isTerminalCobrancaStatus('CANCELADO')).toBe(true);
  });

  it('ESTORNADO é terminal', () => {
    expect(isTerminalCobrancaStatus('ESTORNADO')).toBe(true);
  });

  it('ESTORNADO_PARCIAL é terminal', () => {
    expect(isTerminalCobrancaStatus('ESTORNADO_PARCIAL')).toBe(true);
  });

  it('PAGO não é terminal (pode ser estornado)', () => {
    expect(isTerminalCobrancaStatus('PAGO')).toBe(false);
  });

  it('PENDENTE não é terminal', () => {
    expect(isTerminalCobrancaStatus('PENDENTE')).toBe(false);
  });

  it('ATRASADO não é terminal', () => {
    expect(isTerminalCobrancaStatus('ATRASADO')).toBe(false);
  });
});

describe('isTerminalChargeStatus', () => {
  it('CANCELED é terminal', () => {
    expect(isTerminalChargeStatus('CANCELED')).toBe(true);
  });

  it('REFUNDED é terminal', () => {
    expect(isTerminalChargeStatus('REFUNDED')).toBe(true);
  });

  it('PAID não é terminal', () => {
    expect(isTerminalChargeStatus('PAID')).toBe(false);
  });

  it('OPEN não é terminal', () => {
    expect(isTerminalChargeStatus('OPEN')).toBe(false);
  });
});

describe('TERMINAL_COBRANCA_STATUSES', () => {
  it('contém os 3 status terminais corretos', () => {
    expect(TERMINAL_COBRANCA_STATUSES).toContain('CANCELADO');
    expect(TERMINAL_COBRANCA_STATUSES).toContain('ESTORNADO');
    expect(TERMINAL_COBRANCA_STATUSES).toContain('ESTORNADO_PARCIAL');
    expect(TERMINAL_COBRANCA_STATUSES).toHaveLength(3);
  });
});

describe('TERMINAL_CHARGE_STATUSES', () => {
  it('contém os 2 status terminais corretos', () => {
    expect(TERMINAL_CHARGE_STATUSES).toContain('CANCELED');
    expect(TERMINAL_CHARGE_STATUSES).toContain('REFUNDED');
    expect(TERMINAL_CHARGE_STATUSES).toHaveLength(2);
  });
});
