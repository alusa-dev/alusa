import { describe, expect, it, vi } from 'vitest';

import { getRenewalCampaignOverview } from './renewal-management.service';

function basePrisma(overrides: Record<string, unknown> = {}) {
  return {
    rematriculaCampanha: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'camp-1',
        targetPeriodId: '2027',
        campaignStartsAt: new Date('2026-08-21T00:00:00.000Z'),
      }),
    },
    rematriculaProcesso: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'process-1',
          status: 'WAITING_FOR_START',
          itens: [
            {
              id: 'item-1',
              status: 'RENEWED',
              decision: 'RENEW',
              targetClassId: 'class-1',
              targetComboId: null,
              matriculaOrigem: { aluno: { id: 'student-1', nome: 'Aluno 1', foto: null } },
            },
          ],
          reservas: [],
        },
      ]),
    },
    combo: { findMany: vi.fn().mockResolvedValue([]) },
    turma: {
      findMany: vi.fn().mockResolvedValue([{ id: 'class-1', nome: 'Turma A', capacidade: 2 }]),
    },
    reservaVagaFutura: { findMany: vi.fn().mockResolvedValue([]) },
    matricula: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('getRenewalCampaignOverview', () => {
  it('agrupa alunos por turma e considera reservas na ocupação', async () => {
    const prisma = basePrisma({
      reservaVagaFutura: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'reservation-1',
            itemId: null,
            targetClassId: 'class-1',
            status: 'RESERVED',
            matriculaFuturaId: null,
          },
        ]),
      },
    });

    const result = await getRenewalCampaignOverview(
      { contaId: 'conta-1', campaignId: 'camp-1' },
      { prisma: prisma as never },
    );

    expect(result.totalTurmas).toBe(1);
    expect(result.totalConfirmados).toBe(1);
    expect(result.turmas[0]).toMatchObject({
      turmaId: 'class-1',
      ocupadas: 1,
      reservasAtivas: 1,
      vagasDisponiveis: 1,
      statusCapacidade: 'DISPONIVEL',
    });
    expect(result.turmas[0]?.alunos[0]).toMatchObject({ alunoNome: 'Aluno 1' });

    expect(prisma.rematriculaCampanha.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'camp-1', contaId: 'conta-1' } }),
    );
  });

  it('não cria agrupamento fictício e registra inconsistência quando não há turma destino', async () => {
    const prisma = basePrisma({
      rematriculaProcesso: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'process-1',
            status: 'CONFIRMED',
            itens: [
              {
                id: 'item-1',
                status: 'RENEWED',
                decision: 'RENEW',
                targetClassId: null,
                targetComboId: null,
                matriculaOrigem: { aluno: { id: 'student-1', nome: 'Aluno 1', foto: null } },
              },
            ],
            reservas: [],
          },
        ]),
      },
    });

    const result = await getRenewalCampaignOverview(
      { contaId: 'conta-1', campaignId: 'camp-1' },
      { prisma: prisma as never },
    );

    expect(result.turmas).toHaveLength(0);
    expect(result.inconsistenciasSemTurma).toBe(1);
  });
});
