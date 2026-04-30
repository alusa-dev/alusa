import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormaPagamento } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  aluno: {
    findFirst: vi.fn(),
  },
  matricula: {
    findFirst: vi.fn(),
  },
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

const { criarMatricula } = await import('@/src/server/matriculas/matricula.service');

describe('criarMatricula conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia matrícula duplicada do mesmo aluno na mesma turma', async () => {
    prismaMock.aluno.findFirst.mockResolvedValueOnce({
      id: 'aluno-1',
      status: 'ATIVO',
      dataNasc: new Date('2000-01-01'),
    });
    prismaMock.matricula.findFirst.mockResolvedValueOnce({ id: 'mat-existente' });

    const dataInicio = new Date('2026-04-01T00:00:00.000Z');
    const dataFimContrato = new Date('2027-03-31T00:00:00.000Z');

    await expect(
      criarMatricula({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        turmaId: 'turma-1',
        planoId: 'plano-1',
        taxaMatricula: 0,
        taxaIsenta: true,
        pagarTaxaAgora: false,
        gerarCobrancaTaxa: false,
        criarCobranca: true,
        formaPagamento: FormaPagamento.BOLETO,
        dataInicio,
        dataFimContrato,
        vencimentoDia: 5,
        createdById: 'user-1',
      }),
    ).rejects.toMatchObject({
      name: 'MatriculaConflictError',
      code: 'MATRICULA_DUPLICADA_TURMA',
      message: 'Este aluno já está matriculado nesta turma.',
    });
  });
});
