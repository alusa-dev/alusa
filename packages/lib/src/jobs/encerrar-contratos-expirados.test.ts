import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do prisma
vi.mock('../prisma', () => ({
  prisma: {
    conta: {
      findUnique: vi.fn(),
    },
    matricula: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    matriculaLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn({
      matricula: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      matriculaLog: { create: vi.fn().mockResolvedValue({}) },
    })),
  },
}));

vi.mock('../notifications/domain-notifications', () => ({
  createContractExpiredNotification: vi.fn(),
  createContractExpiringNotification: vi.fn(),
}));

import { prisma } from '../prisma';

const {
  encerrarContratosExpirados,
  listarContratosProximosDeExpirar,
} = await import('./encerrar-contratos-expirados');
const { notifyContractsExpiring } = await import('./notify-contracts-expiring');
import { createContractExpiringNotification } from '../notifications/domain-notifications';

describe('encerrar-contratos-expirados job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.conta.findUnique).mockResolvedValue({ timezone: 'America/Sao_Paulo' } as never);
  });

  describe('encerrarContratosExpirados', () => {
    it('deve retornar 0 processados quando não há matrículas expiradas', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      const result = await encerrarContratosExpirados('conta-1', {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(result.processados).toBe(0);
      expect(result.atualizados).toBe(0);
      expect(result.erros).toHaveLength(0);
    });

    it('deve processar matrículas expiradas corretamente', async () => {
      const ontem = new Date('2026-09-06T12:00:00.000Z');

      vi.mocked(prisma.matricula.findMany).mockResolvedValue([
        {
          id: 'matricula-1',
          dataFimContrato: ontem,
          dataFim: null,
          alunoId: 'aluno-1',
          aluno: { nome: 'Aluno 1', contaId: 'conta-1' },
        },
        {
          id: 'matricula-2',
          dataFimContrato: ontem,
          dataFim: null,
          alunoId: 'aluno-2',
          aluno: { nome: 'Aluno 2', contaId: 'conta-1' },
        },
      ] as never);

      const result = await encerrarContratosExpirados('conta-1', {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(result.processados).toBe(2);
      expect(result.atualizados).toBe(2);
      expect(result.erros).toHaveLength(0);
    });

    it('deve filtrar por contaId quando informado', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      await encerrarContratosExpirados('conta-123', {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contaId: 'conta-123',
            NOT: expect.any(Array),
          }),
        }),
      );
    });

    it('deve registrar erros quando transação falhar', async () => {
      const ontem = new Date('2026-09-06T12:00:00.000Z');

      vi.mocked(prisma.matricula.findMany).mockResolvedValue([
        {
          id: 'matricula-1',
          dataFimContrato: ontem,
          dataFim: null,
          alunoId: 'aluno-1',
          aluno: { nome: 'Aluno 1', contaId: 'conta-1' },
        },
      ] as never);

      vi.mocked(prisma.$transaction).mockRejectedValue(new Error('Erro de banco'));

      const result = await encerrarContratosExpirados('conta-1', {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(result.processados).toBe(1);
      expect(result.atualizados).toBe(0);
      expect(result.erros).toHaveLength(1);
      expect(result.erros[0].matriculaId).toBe('matricula-1');
      expect(result.erros[0].erro).toBe('Erro de banco');
    });

    it('mantém o último dia inteiro e só encerra no dia acadêmico seguinte', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      const ultimoDiaNoInicio = await encerrarContratosExpirados('conta-1', {
        now: new Date('2026-09-07T03:01:00.000Z'),
      });
      const ultimoDiaNoFim = await encerrarContratosExpirados('conta-1', {
        now: new Date('2026-09-08T02:59:00.000Z'),
      });

      expect(ultimoDiaNoInicio.atualizados).toBe(0);
      expect(ultimoDiaNoFim.atualizados).toBe(0);
      expect(prisma.matricula.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            dataFimContrato: { lt: new Date('2026-09-07T00:00:00.000Z') },
          }),
        }),
      );
      expect(prisma.matricula.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            dataFimContrato: { lt: new Date('2026-09-07T00:00:00.000Z') },
          }),
        }),
      );

      vi.mocked(prisma.matricula.findMany).mockResolvedValueOnce([
        {
          id: 'mat-next-day',
          dataFimContrato: new Date('2026-09-07T12:00:00.000Z'),
          dataFim: null,
          alunoId: 'aluno-1',
          aluno: { nome: 'Aluno', contaId: 'conta-1' },
        },
      ] as never);
      const nextDay = await encerrarContratosExpirados('conta-1', {
        now: new Date('2026-09-08T03:01:00.000Z'),
      });

      expect(nextDay.processados).toBe(1);
      expect(prisma.matricula.findMany).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          where: expect.objectContaining({
            dataFimContrato: { lt: new Date('2026-09-08T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('usa o timezone da Conta para determinar o dia acadêmico', async () => {
      vi.mocked(prisma.conta.findUnique).mockResolvedValue({ timezone: 'America/Manaus' } as never);
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      await encerrarContratosExpirados('conta-manaus', {
        now: new Date('2026-09-08T03:30:00.000Z'),
      });

      expect(prisma.conta.findUnique).toHaveBeenCalledWith({
        where: { id: 'conta-manaus' },
        select: { timezone: true },
      });
      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dataFimContrato: { lt: new Date('2026-09-07T00:00:00.000Z') },
          }),
        }),
      );
    });
  });

  describe('listarContratosProximosDeExpirar', () => {
    it('deve retornar lista vazia quando não há contratos próximos de expirar', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      const result = await listarContratosProximosDeExpirar('conta-123', 30, {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(result).toHaveLength(0);
    });

    it('deve calcular dias restantes corretamente', async () => {
      const em15Dias = new Date('2026-09-22T12:00:00.000Z');

      vi.mocked(prisma.matricula.findMany).mockResolvedValue([
        {
          id: 'matricula-1',
          dataFimContrato: em15Dias,
          aluno: { nome: 'Aluno Teste' },
        },
      ] as never);

      const result = await listarContratosProximosDeExpirar('conta-123', 30, {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(result).toHaveLength(1);
      expect(result[0].diasRestantes).toBe(15);
      expect(result[0].alunoNome).toBe('Aluno Teste');
    });

    it('deve usar antecedência padrão de 30 dias', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      await listarContratosProximosDeExpirar('conta-123', 30, {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dataFimContrato: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });

    it('calcula alertas por dias civis, incluindo hoje e os limiares 1, 3 e 7', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([
        {
          id: 'today',
          dataFimContrato: new Date('2026-09-07T00:00:00.000Z'),
          aluno: { nome: 'Hoje' },
        },
        {
          id: 'tomorrow',
          dataFimContrato: new Date('2026-09-08T12:00:00.000Z'),
          aluno: { nome: 'Amanhã' },
        },
        {
          id: 'three-days',
          dataFimContrato: new Date('2026-09-10T12:00:00.000Z'),
          aluno: { nome: 'Três' },
        },
        {
          id: 'seven-days',
          dataFimContrato: new Date('2026-09-14T12:00:00.000Z'),
          aluno: { nome: 'Sete' },
        },
      ] as never);

      const result = await listarContratosProximosDeExpirar('conta-123', 30, {
        now: new Date('2026-09-07T04:30:00.000Z'),
      });

      expect(result.map((item) => item.diasRestantes)).toEqual([0, 1, 3, 7]);
    });
  });

  it('notifica somente os contratos nos limiares civis de 7, 3 e 1 dia', async () => {
    vi.mocked(prisma.matricula.findMany).mockResolvedValue([
      { id: 'today', dataFimContrato: new Date('2026-09-07T12:00:00.000Z'), aluno: { nome: 'Hoje' } },
      { id: 'one-day', dataFimContrato: new Date('2026-09-08T12:00:00.000Z'), aluno: { nome: 'Um' } },
      { id: 'three-days', dataFimContrato: new Date('2026-09-10T12:00:00.000Z'), aluno: { nome: 'Três' } },
      { id: 'seven-days', dataFimContrato: new Date('2026-09-14T12:00:00.000Z'), aluno: { nome: 'Sete' } },
    ] as never);

    const result = await notifyContractsExpiring('conta-123', {
      now: new Date('2026-09-07T04:30:00.000Z'),
    });

    expect(result).toEqual({ evaluated: 4, notified: 3 });
    expect(createContractExpiringNotification).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(createContractExpiringNotification).mock.calls.map(([input]) => input.diasRestantes),
    ).toEqual([1, 3, 7]);
  });
});
