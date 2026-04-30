import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, upsertMock, queryRawMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    contaFinancialPolicy: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
    $queryRaw: queryRawMock,
  },
}));

const { getContaFinancialPolicyRecord, upsertContaFinancialPolicy } = await import('./rematricula-financial-policy.service');

describe('rematricula-financial-policy.service persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normaliza enums atuais do Prisma ao ler a política', async () => {
    findUniqueMock.mockResolvedValue({
      rematriculaDebtPolicy: 'PERMITIR_COM_AUTORIZACAO_ADMINISTRATIVA',
      allowNewFinancialCycleWithOpenDebt: true,
      debtScope: 'SOMENTE_ATRASADAS',
      overrideRoles: ['ADMIN'],
      requireOverrideReason: true,
      requireFullAudit: true,
      blockOnUnknownFinancialStatus: false,
      updatedAt: new Date('2026-04-01T15:00:00.000Z'),
    });

    const policy = await getContaFinancialPolicyRecord('conta-1');

    expect(policy).toMatchObject({
      preset: 'CONTROLADA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: ['ADMIN'],
    });
  });

  it('persiste os enums atuais do Prisma ao salvar a política', async () => {
    upsertMock.mockResolvedValue({
      rematriculaDebtPolicy: 'BLOQUEAR_REMATRICULA',
      allowNewFinancialCycleWithOpenDebt: false,
      debtScope: 'SOMENTE_ATRASADAS',
      overrideRoles: [],
      requireOverrideReason: false,
      requireFullAudit: true,
      blockOnUnknownFinancialStatus: true,
      updatedAt: new Date('2026-04-01T15:05:00.000Z'),
    });

    await upsertContaFinancialPolicy('conta-1', {
      preset: 'RESTRITIVA',
      debtScope: 'APENAS_VENCIDAS',
      overrideRoles: ['ADMIN', 'FINANCEIRO'],
    });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contaId: 'conta-1' },
        update: expect.objectContaining({
          rematriculaDebtPolicy: 'BLOQUEAR_REMATRICULA',
          debtScope: 'SOMENTE_ATRASADAS',
          overrideRoles: [],
          allowNewFinancialCycleWithOpenDebt: false,
          blockOnUnknownFinancialStatus: true,
        }),
        create: expect.objectContaining({
          contaId: 'conta-1',
          rematriculaDebtPolicy: 'BLOQUEAR_REMATRICULA',
          debtScope: 'SOMENTE_ATRASADAS',
          overrideRoles: [],
          allowNewFinancialCycleWithOpenDebt: false,
          blockOnUnknownFinancialStatus: true,
        }),
      }),
    );
  });
});