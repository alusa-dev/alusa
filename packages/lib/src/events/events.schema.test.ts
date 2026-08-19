import { describe, expect, it } from 'vitest';

import { registerEventParticipantRequestSchema } from './events.schema';

describe('event participant billing schema', () => {
  const base = {
    alunoId: 'aluno-1',
    registrationFeeCharged: 780,
    billingMethod: 'BOLETO' as const,
    chargeType: 'INSTALLMENT' as const,
    installmentCount: 3,
    dueDate: '2026-09-10',
  };

  it('accepts an entry and validates the balance billing data', () => {
    const result = registerEventParticipantRequestSchema.parse({
      ...base,
      hasEntry: true,
      entryAmount: 180,
      entryPaymentMethod: 'CASH',
    });

    expect(result.hasEntry).toBe(true);
    expect(result.entryAmount).toBe(180);
  });

  it('rejects an entry equal to or greater than the total fee', () => {
    expect(() => registerEventParticipantRequestSchema.parse({
      ...base,
      hasEntry: true,
      entryAmount: 780,
      entryPaymentMethod: 'CASH',
    })).toThrow('A entrada deve ser menor que a taxa total.');
  });

  it('keeps the existing billing flow valid without an entry', () => {
    const result = registerEventParticipantRequestSchema.parse({
      alunoId: 'aluno-1',
      registrationFeeCharged: 780,
      billingMethod: 'BOLETO',
      chargeType: 'ONE_TIME',
      dueDate: '2026-09-10',
    });

    expect(result.hasEntry).toBe(false);
  });

  it('validates an entry against the total of a grouped billing request', () => {
    const result = registerEventParticipantRequestSchema.parse({
      ...base,
      additionalAlunoIds: ['aluno-2'],
      responsavelId: 'responsavel-1',
      hasEntry: true,
      entryAmount: 1_000,
      entryPaymentMethod: 'CASH',
    });

    expect(result.additionalAlunoIds).toEqual(['aluno-2']);
  });

  it('requires the financial responsible for a grouped request with entry', () => {
    expect(() => registerEventParticipantRequestSchema.parse({
      ...base,
      additionalAlunoIds: ['aluno-2'],
      hasEntry: true,
      entryAmount: 180,
      entryPaymentMethod: 'CASH',
    })).toThrow('responsável financeiro');
  });
});
