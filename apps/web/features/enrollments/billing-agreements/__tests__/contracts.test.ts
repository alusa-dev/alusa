import { describe, expect, it } from 'vitest';

import {
  billingAgreementCommitRequestSchema,
  billingAgreementPreviewRequestSchema,
} from '../contracts';

const base = {
  agreementId: 'agreement-1',
  effectivePolicy: 'CURRENT_CYCLE' as const,
  effectiveDate: '2026-07-21',
  reason: 'Inclusão solicitada pela secretaria',
};

describe('billing agreement HTTP contracts', () => {
  it('aceita inclusão com valores em centavos', () => {
    const result = billingAgreementPreviewRequestSchema.safeParse({
      ...base,
      operation: 'ADD_ALLOCATION',
      allocations: [
        {
          matriculaId: 'enrollment-1',
          kind: 'TUITION',
          baseAmountCents: 15_000,
          discountAmountCents: 2_000,
          validFrom: '2026-07-21',
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejeita desconto acima do valor-base', () => {
    const result = billingAgreementPreviewRequestSchema.safeParse({
      ...base,
      operation: 'ADD_ALLOCATION',
      allocations: [
        {
          matriculaId: 'enrollment-1',
          baseAmountCents: 10_000,
          discountAmountCents: 10_001,
          validFrom: '2026-07-21',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejeita alocação com intervalo de vigência vazio', () => {
    const result = billingAgreementPreviewRequestSchema.safeParse({
      ...base,
      operation: 'ADD_ALLOCATION',
      allocations: [
        {
          matriculaId: 'enrollment-1',
          baseAmountCents: 10_000,
          validFrom: '2026-07-21',
          validUntil: '2026-07-21',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('exige allocationId ao alterar valor', () => {
    const result = billingAgreementPreviewRequestSchema.safeParse({
      ...base,
      operation: 'UPDATE_ALLOCATION',
      allocations: [
        {
          matriculaId: 'enrollment-1',
          baseAmountCents: 18_000,
          validFrom: '2026-07-21',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejeita transferência para o mesmo acordo', () => {
    const result = billingAgreementPreviewRequestSchema.safeParse({
      ...base,
      operation: 'TRANSFER_ALLOCATION',
      targetAgreementId: base.agreementId,
      allocationIds: ['allocation-1'],
    });

    expect(result.success).toBe(false);
  });

  it('não aceita contaId enviado pelo client', () => {
    const result = billingAgreementPreviewRequestSchema.safeParse({
      ...base,
      contaId: 'tenant-forged',
      operation: 'REMOVE_ALLOCATION',
      allocationIds: ['allocation-1'],
    });

    expect(result.success).toBe(false);
  });

  it('exige hash, idempotência e versão no commit', () => {
    const result = billingAgreementCommitRequestSchema.safeParse({
      ...base,
      operation: 'CANCEL_AGREEMENT',
      idempotencyKey: 'change-request-123',
      previewHash: 'preview-hash-123456789',
      previewExpiresAt: '2026-07-21T13:00:00.000Z',
      expectedVersion: 7,
    });

    expect(result.success).toBe(true);
  });
});
