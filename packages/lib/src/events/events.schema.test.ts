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

  it('accepts a manual fixed discount', () => {
    const result = registerEventParticipantRequestSchema.parse({
      alunoId: 'aluno-1',
      registrationFeeCharged: 725,
      registrationFeeOriginal: 780,
      discountType: 'FIXED',
      discountValue: 55,
      billingMethod: 'MANUAL_RECEIVED',
    });

    expect(result.discountValue).toBe(55);
  });

  it('accepts a partial manual payment or no initial payment', () => {
    const result = registerEventParticipantRequestSchema.parse({
      ...base,
      billingMethod: 'MANUAL_RECEIVED',
      chargeType: 'ONE_TIME',
      initialPaymentAmount: 390,
      initialPaymentMethod: 'MANUAL_PIX',
    });

    expect(result.initialPaymentAmount).toBe(390);
    expect(registerEventParticipantRequestSchema.parse({
      ...base,
      billingMethod: 'MANUAL_RECEIVED',
      chargeType: 'ONE_TIME',
      initialPaymentAmount: 0,
    }).initialPaymentAmount).toBe(0);
  });

  it('accepts a fully paid manual grouped request using the group total', () => {
    const result = registerEventParticipantRequestSchema.parse({
      alunoId: 'aluno-1',
      additionalAlunoIds: ['aluno-2'],
      responsavelId: 'responsavel-1',
      registrationFeeCharged: 702,
      registrationFeeOriginal: 780,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      billingMethod: 'MANUAL_RECEIVED',
      initialPaymentAmount: 1404,
      initialPaymentMethod: 'EXTERNAL_CARD',
    });

    expect(result.initialPaymentAmount).toBe(1404);
  });

  it('rejects a manual grouped payment above the group total', () => {
    expect(() => registerEventParticipantRequestSchema.parse({
      alunoId: 'aluno-1',
      additionalAlunoIds: ['aluno-2'],
      responsavelId: 'responsavel-1',
      registrationFeeCharged: 702,
      registrationFeeOriginal: 780,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      billingMethod: 'MANUAL_RECEIVED',
      initialPaymentAmount: 1405,
      initialPaymentMethod: 'EXTERNAL_CARD',
    })).toThrow('O valor recebido não pode ser maior que o valor final da inscrição.');
  });

  it('rejects an initial manual payment above the final amount', () => {
    expect(() => registerEventParticipantRequestSchema.parse({
      ...base,
      billingMethod: 'MANUAL_RECEIVED',
      chargeType: 'ONE_TIME',
      initialPaymentAmount: 781,
      initialPaymentMethod: 'MANUAL_PIX',
    })).toThrow('O valor recebido não pode ser maior que o valor final da inscrição.');
  });

  it('accepts a discount for digital billing', () => {
    const result = registerEventParticipantRequestSchema.parse({
      alunoId: 'aluno-1',
      registrationFeeCharged: 725,
      registrationFeeOriginal: 780,
      discountType: 'FIXED',
      discountValue: 55,
      billingMethod: 'PIX',
      chargeType: 'ONE_TIME',
      dueDate: '2026-09-10',
    });

    expect(result.discountValue).toBe(55);
  });

  it('validates a group discount against the combined original amount', () => {
    const result = registerEventParticipantRequestSchema.parse({
      alunoId: 'aluno-1',
      additionalAlunoIds: ['aluno-2', 'aluno-3'],
      responsavelId: 'responsavel-1',
      registrationFeeCharged: 702,
      registrationFeeOriginal: 780,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      billingMethod: 'BOLETO',
      chargeType: 'ONE_TIME',
      dueDate: '2026-09-10',
    });

    expect(result.discountValue).toBe(10);
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
