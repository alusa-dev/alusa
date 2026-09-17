import { describe, expect, it } from 'vitest';

import {
  getEffectiveRemotePaymentStatus,
  resolveAcademicPaymentOrigin,
  resolveAcademicDisplayedStatus,
  resolveStandaloneDisplayedStatus,
  resolveStandaloneLiquidacaoStatus,
} from '../display-status';

describe('cobrancas display status', () => {
  it('normaliza a origem acadêmica sem duplicar regra no route handler', () => {
    expect(resolveAcademicPaymentOrigin('PARCELADA')).toBe('INSTALLMENT');
    expect(resolveAcademicPaymentOrigin('RECORRENTE')).toBe('SUBSCRIPTION');
    expect(resolveAcademicPaymentOrigin('TAXA_MATRICULA')).toBe('ENROLLMENT_FEE');
    expect(resolveAcademicPaymentOrigin('MENSALIDADE')).toBe('ACADEMIC');
  });

  it('prioriza o snapshot normalizado do provedor', () => {
    expect(
      getEffectiveRemotePaymentStatus({
        status: 'RECEIVED_IN_CASH',
        billingType: 'RECEIVED_IN_CASH',
      }),
    ).toBe('RECEIVED_IN_CASH');
    expect(getEffectiveRemotePaymentStatus(null)).toBeNull();
  });

  it('mantém o status local quando não há estado remoto', () => {
    expect(resolveStandaloneDisplayedStatus({ localChargeStatus: 'PENDING' })).toBe('PENDENTE');
    expect(
      resolveAcademicDisplayedStatus({
        localCobrancaStatus: 'PENDENTE',
        dueDate: new Date('2026-09-15T12:00:00Z'),
      }),
    ).toBe('PENDENTE');
  });

  it('não cria liquidação para cobrança que não está paga', () => {
    expect(
      resolveStandaloneLiquidacaoStatus({
        displayedStatus: 'PENDENTE',
        remotePaymentStatus: 'PENDING',
      }),
    ).toBeNull();
  });
});
