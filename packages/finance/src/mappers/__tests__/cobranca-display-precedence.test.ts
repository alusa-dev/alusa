import { describe, expect, it } from 'vitest';
import {
  chooseHighestPrecedenceCobrancaDisplayStatus,
  mapChargeStatusToCobrancaDisplayStatus,
} from '../cobranca-display-precedence';

describe('cobranca display precedence', () => {
  it('preserves the existing display precedence when combining local and remote state', () => {
    expect(chooseHighestPrecedenceCobrancaDisplayStatus(['PENDENTE', 'PAGO'])).toBe('PAGO');
    expect(chooseHighestPrecedenceCobrancaDisplayStatus(['ESTORNADO', 'CANCELADO'])).toBe('CANCELADO');
  });

  it('maps local charge statuses without changing persistence state', () => {
    expect(mapChargeStatusToCobrancaDisplayStatus('OPEN')).toBe('PENDENTE');
    expect(mapChargeStatusToCobrancaDisplayStatus('PAID')).toBe('PAGO');
    expect(mapChargeStatusToCobrancaDisplayStatus('UNKNOWN')).toBeNull();
  });
});
