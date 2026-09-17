import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    matricula: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

import { prisma } from '@alusa/database';
import { auditLogService } from '../foundation/audit-log.service';
import { applyMatriculaTimeoutJob } from './apply-matricula-timeout';

const oldMatricula = (overrides: Record<string, unknown> = {}) => ({
  id: 'mat-1',
  status: 'PENDENTE_TAXA',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  asaasSubscriptionId: null,
  aluno: { id: 'aluno-1', nome: 'Aluno 1', contaId: 'conta-1' },
  ...overrides,
});

describe('applyMatriculaTimeoutJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([oldMatricula()] as never);
    vi.mocked(prisma.matricula.update).mockResolvedValue({} as never);
    vi.mocked(auditLogService.record).mockResolvedValue(undefined);
  });

  it('não marca localmente uma matrícula com assinatura se o provedor não estiver disponível', async () => {
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([
      oldMatricula({ asaasSubscriptionId: 'sub-1' }),
    ] as never);

    const result = await applyMatriculaTimeoutJob({ timeoutDays: 30 });

    expect(result.canceladas).toBe(0);
    expect(result.erros).toEqual([
      { matriculaId: 'mat-1', erro: 'MATRICULA_TIMEOUT_PROVIDER_UNAVAILABLE' },
    ]);
    expect(prisma.matricula.update).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('cancela no provedor antes de persistir o timeout local', async () => {
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([
      oldMatricula({ asaasSubscriptionId: 'sub-1' }),
    ] as never);
    const cancelSubscription = vi.fn().mockResolvedValue({ success: true });

    const result = await applyMatriculaTimeoutJob(
      { timeoutDays: 30 },
      { paymentsProvider: { cancelSubscription } as never },
    );

    expect(result.canceladas).toBe(1);
    expect(result.erros).toHaveLength(0);
    expect(cancelSubscription).toHaveBeenCalledWith({
      contaId: 'conta-1',
      subscriptionId: 'sub-1',
    });
    expect(prisma.matricula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mat-1' },
        data: expect.objectContaining({ status: 'CANCELADA' }),
      }),
    );
    expect(cancelSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.matricula.update).mock.invocationCallOrder[0]!,
    );
  });

  it('mantém o timeout local para matrícula sem assinatura', async () => {
    const result = await applyMatriculaTimeoutJob({ timeoutDays: 30 });

    expect(result.canceladas).toBe(1);
    expect(prisma.matricula.update).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).toHaveBeenCalledTimes(1);
  });
});
