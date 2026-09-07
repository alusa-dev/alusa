import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { buildPortalStandaloneChargeOwnershipWhere } from '@/features/portal/finance-standalone';

describe('portal standalone obligation ownership', () => {
  it('does not broaden a student scope through a shared Customer alias', () => {
    const where = buildPortalStandaloneChargeOwnershipWhere({
      contaId: 'conta-a',
      alunoIds: ['aluno-1'],
      responsavelIds: [],
      matriculaIds: ['matricula-1'],
      familyGroupIds: [],
    });

    expect(where.OR).toEqual(
      expect.arrayContaining([
        { payerType: 'ALUNO', payerId: { in: ['aluno-1'] } },
        {
          sale: {
            contaId: 'conta-a',
            OR: [
              { alunoId: { in: ['aluno-1'] } },
              { matriculaId: { in: ['matricula-1'] } },
            ],
          },
        },
      ]),
    );

    const serialized = JSON.stringify(where);
    expect(serialized).not.toContain('customer');
    expect(serialized).not.toContain('RESPONSAVEL');
  });

  it('uses the explicit responsible payer without treating the identity as ownership', () => {
    const where = buildPortalStandaloneChargeOwnershipWhere({
      contaId: 'conta-a',
      alunoIds: [],
      responsavelIds: ['responsavel-1'],
      matriculaIds: [],
      familyGroupIds: [],
    });

    expect(where.OR).toEqual(
      expect.arrayContaining([{ payerType: 'RESPONSAVEL', payerId: { in: ['responsavel-1'] } }]),
    );
    expect(JSON.stringify(where)).not.toContain('customer');
  });
});
