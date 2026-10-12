import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), process: vi.fn() }));
vi.mock('./processor', () => ({
  enqueueFamilyBillingOutbox: mocks.enqueue,
  parseFamilyBillingPayload: (payload: unknown) => payload,
  processFamilyBillingOutboxEvent: mocks.process,
}));

import { provisionFutureFamilyEnrollment } from './future-family-enrollment.use-case';

const payload = {
  aggregateType: 'MATRICULA_FAMILIAR' as const, aggregateId: 'family-1', contaId: 'conta-1',
  responsavelId: 'responsavel-1', responsavelNome: 'Responsável', totalAlunos: 1,
  monthlyValue: 120, enrollmentFeeValue: 40, billingType: 'BOLETO' as const,
  cycle: 'MONTHLY' as const, nextDueDate: '2026-11-01', endDate: '2027-10-31',
  enrollmentFeeDueDate: '2026-10-10', description: 'Matrícula', actorId: 'user-1', operationId: 'op-1',
};

describe('provisionFutureFamilyEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueue.mockImplementation(async ({ eventType }: { eventType: string }) => ({ id: eventType }));
    mocks.process.mockResolvedValue({ processed: true });
  });

  it('cobra taxa imediatamente e mantém a recorrência agendada na vigência', async () => {
    const availableAt = new Date('2026-11-01T04:00:00.000Z');
    const result = await provisionFutureFamilyEnrollment({ payload, matriculaFamiliarId: 'family-1', availableAt });
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'FUTURE_FAMILY_ENROLLMENT_FEE:op-1',
      payload: { monthlyValue: 0, billingPhase: 'ENROLLMENT_FEE', deferActivationUntil: availableAt.toISOString() },
    });
    expect(mocks.enqueue.mock.calls[1]?.[0]).toMatchObject({
      eventType: 'FUTURE_FAMILY_RECURRING:op-1', availableAt,
      payload: { billingPhase: 'RECURRING', scheduledEffectiveAt: availableAt.toISOString() },
    });
    expect(mocks.process).toHaveBeenCalledWith('FUTURE_FAMILY_ENROLLMENT_FEE:op-1');
    expect(result).toMatchObject({ status: 'PENDING', feeConfirmed: true });
  });

  it('preserva estado parcial se o webhook da taxa ainda não confirmou a cobrança', async () => {
    mocks.process.mockResolvedValue({ processed: false, reason: 'REQUIRES_RECONCILIATION' });
    const result = await provisionFutureFamilyEnrollment({ payload, matriculaFamiliarId: 'family-1', availableAt: new Date('2026-11-01T04:00:00.000Z') });
    expect(result.status).toBe('PARTIAL');
    expect(result.error).toContain('RESULTADO_INCERTO');
  });
});
