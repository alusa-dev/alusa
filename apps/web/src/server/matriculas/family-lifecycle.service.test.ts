import { describe, expect, it, vi } from 'vitest';
import { syncFamilyLifecycleAggregate } from './family-lifecycle.service';

describe('syncFamilyLifecycleAggregate', () => {
  it('recalcula o total familiar a partir das alocações canônicas restantes', async () => {
    const update = vi.fn();
    const prisma = {
      matriculaFamiliar: {
        findFirst: vi.fn().mockResolvedValue({
        id: 'family-1',
        status: 'ATIVO',
        valorMensalidadeTotal: 300,
        standaloneSubscriptionId: null,
        matriculas: [{ status: 'CANCELADA' }, { status: 'ATIVA' }],
        }),
        update,
      },
      billingAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netAmount: 150 } }),
        count: vi.fn().mockResolvedValue(1),
      },
    } as never;

    const result = await syncFamilyLifecycleAggregate({
      prisma,
      contaId: 'conta-1',
      familyId: 'family-1',
    });

    expect(result).toMatchObject({
      newStatus: 'PARCIAL',
      remainingStudents: 1,
      previousMonthlyValue: 300,
      newMonthlyValue: 150,
      valueChanged: true,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'family-1' },
      data: {
        status: 'PARCIAL',
        academicStatus: 'PARCIAL',
        totalAlunos: 1,
        valorMensalidadeTotal: 150,
      },
    });
  });

  it('não zera o agregado legado quando ainda não há alocação canônica', async () => {
    const update = vi.fn();
    const prisma = {
      matriculaFamiliar: {
        findFirst: vi.fn().mockResolvedValue({
        id: 'family-1',
        status: 'ATIVO',
        valorMensalidadeTotal: 300,
        standaloneSubscriptionId: null,
        matriculas: [{ status: 'ATIVA' }],
        }),
        update,
      },
      billingAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netAmount: null } }),
        count: vi.fn().mockResolvedValue(0),
      },
    } as never;

    const result = await syncFamilyLifecycleAggregate({
      prisma,
      contaId: 'conta-1',
      familyId: 'family-1',
    });

    expect(result?.newMonthlyValue).toBe(300);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ valorMensalidadeTotal: 300 }),
    }));
  });

  it('sincroniza o read model da assinatura com o novo valor familiar', async () => {
    const subscriptionUpdate = vi.fn();
    const prisma = {
      matriculaFamiliar: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'family-1',
          status: 'ATIVO',
          valorMensalidadeTotal: 300,
          standaloneSubscriptionId: 'subscription-1',
          matriculas: [{ status: 'PAUSADA' }, { status: 'ATIVA' }],
        }),
        update: vi.fn(),
      },
      billingAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { netAmount: 150 } }),
        count: vi.fn().mockResolvedValue(1),
      },
      standaloneSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          billingAgreement: { nextDueDate: new Date('2026-09-04T12:00:00.000Z') },
        }),
        updateMany: subscriptionUpdate,
      },
      charge: {
        findFirst: vi.fn().mockResolvedValue({
          dueDate: new Date('2026-09-04T12:00:00.000Z'),
        }),
      },
    } as never;

    await syncFamilyLifecycleAggregate({
      prisma,
      contaId: 'conta-1',
      familyId: 'family-1',
    });

    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', id: 'subscription-1' },
      data: {
        value: 150,
        nextDueDate: new Date('2026-09-04T12:00:00.000Z'),
      },
    });
  });
});
