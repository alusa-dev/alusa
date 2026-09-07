import { describe, expect, it, vi } from 'vitest';

import { runRenewalIntegrityCheck } from './renewal-integrity.service';

vi.mock('@alusa/lib', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./renewal-governance.service', () => ({
  createRenewalPending: vi.fn().mockResolvedValue({ id: 'pending-1' }),
}));

describe('runRenewalIntegrityCheck', () => {
  it('trata effectiveAt como data civil no mesmo dia, mesmo com timestamp posterior', async () => {
    const prisma = {
      conta: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
      rematriculaProcesso: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'processo-1',
            status: 'CONFIRMED',
            renewCount: 1,
            targetPeriodId: '2026',
            itens: [
              {
                id: 'item-1',
                decision: 'RENEW',
                matriculaOrigemId: 'matricula-origem',
                matriculaFuturaId: 'matricula-futura',
                matriculaOrigem: {
                  id: 'matricula-origem',
                  dataFimContrato: new Date('2026-09-06T12:00:00.000Z'),
                  status: 'ATIVA',
                },
                matriculaFutura: {
                  id: 'matricula-futura',
                  status: 'ATIVA',
                  dataInicio: new Date('2026-09-07T12:00:00.000Z'),
                  turmaId: null,
                  comboId: null,
                },
                targetClassId: null,
                targetComboId: null,
              },
            ],
            effectiveAt: new Date('2026-09-07T12:00:00.000Z'),
            reservas: [{ itemId: 'item-1', status: 'RESERVED' }],
            financeiros: [
              {
                id: 'acordo-1',
                status: 'ACTIVE',
                effectiveAt: new Date('2026-09-07T12:00:00.000Z'),
                asaasPaymentId: 'pay-1',
                asaasSubscriptionId: null,
              },
            ],
            contratos: [],
          },
        ]),
      },
      turma: { findFirst: vi.fn() },
      combo: { findFirst: vi.fn() },
    };

    const result = await runRenewalIntegrityCheck(
      {
        contaId: 'conta-1',
        now: new Date('2026-09-07T04:00:00.000Z'),
      },
      { prisma: prisma as never },
    );

    expect(result).toEqual({ checkedProcesses: 1, issues: 0, codes: [] });
  });
});
