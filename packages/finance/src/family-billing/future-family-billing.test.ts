import { describe, expect, it } from 'vitest';
import { resolveFamilyOperationFutureStart, resolveFutureFamilyBillingAmounts } from './future-family-billing';

describe('resolveFamilyOperationFutureStart', () => {
  it('uses dates of this operation only, not a later unrelated sibling', () => {
    const now = new Date('2026-10-10T12:00:00.000Z');
    expect(resolveFamilyOperationFutureStart({
      members: [
        { id: 'operation-member', status: 'AGUARDANDO_CONFIRMACAO', dataInicio: new Date('2026-10-10T04:00:00.000Z') },
        { id: 'unrelated-future-member', status: 'AGUARDANDO_CONFIRMACAO', dataInicio: new Date('2027-01-01T04:00:00.000Z') },
      ],
      operationMatriculaIds: ['operation-member'],
      now,
      timezone: 'America/Manaus',
    })).toBeNull();
  });
});

describe('resolveFutureFamilyBillingAmounts', () => {
  it('recalcula a recorrência para os alunos ainda billable quando um irmão foi encerrado', () => {
    expect(resolveFutureFamilyBillingAmounts({
      phase: 'RECURRING',
      operationId: 'operation-1',
      payload: { monthlyValue: 300, enrollmentFeeValue: 60 },
      members: [
        { id: 'mat-active', status: 'ATIVA' },
        { id: 'mat-cancelled', status: 'CANCELADA' },
      ],
      allocations: [
        { matriculaId: 'mat-active', amount: 180 },
        { matriculaId: 'mat-cancelled', amount: 120 },
      ],
    })).toEqual({
      kind: 'PROCESS',
      totalAlunos: 1,
      monthlyValue: 180,
      enrollmentFeeValue: 60,
    });
  });

  it('exige reconciliação se não há alocações para calcular o valor restante', () => {
    expect(resolveFutureFamilyBillingAmounts({
      phase: 'RECURRING',
      operationId: 'operation-1',
      payload: { monthlyValue: 300, enrollmentFeeValue: 0 },
      members: [
        { id: 'mat-active', status: 'ATIVA' },
        { id: 'mat-cancelled', status: 'CANCELADA' },
      ],
      allocations: [],
    })).toEqual({ kind: 'REQUIRES_RECONCILIATION' });
  });

  it('não considera aluno pausado billable sem autorização para cobrar durante a pausa', () => {
    expect(resolveFutureFamilyBillingAmounts({
      phase: 'RECURRING',
      operationId: 'operation-1',
      payload: { monthlyValue: 300, enrollmentFeeValue: 0 },
      members: [
        { id: 'mat-active', status: 'ATIVA' },
        { id: 'mat-paused', status: 'PAUSADA', cobrarDurantePausa: false },
      ],
      allocations: [
        { matriculaId: 'mat-active', amount: 180 },
        { matriculaId: 'mat-paused', amount: 120 },
      ],
    })).toEqual({
      kind: 'PROCESS',
      totalAlunos: 1,
      monthlyValue: 180,
      enrollmentFeeValue: 0,
    });
  });

  it('adia a recorrência quando todos os alunos estão temporariamente pausados', () => {
    expect(resolveFutureFamilyBillingAmounts({
      phase: 'RECURRING',
      operationId: 'operation-1',
      payload: { monthlyValue: 300, enrollmentFeeValue: 0 },
      members: [
        { id: 'mat-1', status: 'PAUSADA', cobrarDurantePausa: false },
        { id: 'mat-2', status: 'PAUSADA', cobrarDurantePausa: false },
      ],
      allocations: [
        { matriculaId: 'mat-1', amount: 150 },
        { matriculaId: 'mat-2', amount: 150 },
      ],
    })).toEqual({ kind: 'DEFER_PAUSED' });
  });

  it('mantém taxa de matrícula billable mesmo se o aluno estiver pausado antes da vigência', () => {
    expect(resolveFutureFamilyBillingAmounts({
      phase: 'ENROLLMENT_FEE',
      operationId: 'operation-1',
      payload: { monthlyValue: 0, enrollmentFeeValue: 100 },
      members: [{ id: 'mat-paused', status: 'PAUSADA', cobrarDurantePausa: false }],
      allocations: [{ matriculaId: 'mat-paused', amount: 100 }],
    })).toEqual({
      kind: 'PROCESS',
      totalAlunos: 1,
      monthlyValue: 0,
      enrollmentFeeValue: 100,
    });
  });
});
