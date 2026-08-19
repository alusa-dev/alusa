import { describe, expect, it } from 'vitest';
import {
  canCancelContract,
  canRegenerateContractLink,
  canSignContract,
  canTransitionContractStatus,
  transitionContractStatus,
} from './status-machine';

describe('contract status machine', () => {
  it('permite assinar somente contrato pendente', () => {
    expect(canSignContract('PENDENTE')).toBe(true);
    expect(canSignContract('EXPIRADO')).toBe(false);
    expect(canSignContract('ASSINADO')).toBe(false);
  });

  it('permite cancelar pendente ou expirado, sem reabrir contrato assinado', () => {
    expect(canCancelContract('PENDENTE')).toBe(true);
    expect(canCancelContract('EXPIRADO')).toBe(true);
    expect(canCancelContract('ASSINADO')).toBe(false);
    expect(canRegenerateContractLink('EXPIRADO')).toBe(true);
    expect(canRegenerateContractLink('ASSINADO')).toBe(false);
    expect(canTransitionContractStatus('EXPIRADO', 'PENDENTE')).toBe(true);
  });

  it('rejeita transições que reabrem histórico assinado', () => {
    expect(() => transitionContractStatus('ASSINADO', 'PENDENTE')).toThrow(
      'CONTRACT_INVALID_STATUS_TRANSITION',
    );
    expect(transitionContractStatus('PENDENTE', 'EXPIRADO')).toBe('EXPIRADO');
  });
});
