import { describe, expect, it, vi } from 'vitest';
import { buildContractEvidencePayloadHash, createContractEvidence } from './create-contract-evidence';

describe('contract evidence', () => {
  it('gera hash determinístico do payload', () => {
    expect(buildContractEvidencePayloadHash({ z: 1, a: { c: true, b: 'x' } })).toBe(
      buildContractEvidencePayloadHash({ a: { b: 'x', c: true }, z: 1 }),
    );
  });

  it('persiste evidência append-only com hash canônico', async () => {
    const db = {
      contractEvidence: {
        create: vi.fn(async () => ({})),
      },
    };

    const result = await createContractEvidence(db, {
      contaId: 'conta-1',
      contratoId: 'contrato-1',
      type: 'SIGNATURE_ACCEPTED',
      payload: { accepted: true, version: 1 },
    });

    expect(result.payloadHash).toHaveLength(64);
    expect(db.contractEvidence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contaId: 'conta-1',
        contratoId: 'contrato-1',
        type: 'SIGNATURE_ACCEPTED',
        payloadHash: result.payloadHash,
      }),
    });
  });
});
