import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do prisma
vi.mock('@/prisma/client', () => ({
  prisma: {
    matricula: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    matriculaLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn({
      matricula: { update: vi.fn().mockResolvedValue({}) },
      matriculaLog: { create: vi.fn().mockResolvedValue({}) },
    })),
  },
}));

import { prisma } from '@/prisma/client';

const { encerrarContratosExpirados, listarContratosProximosDeExpirar } = await import('./encerrar-contratos-expirados');

describe('encerrar-contratos-expirados job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('encerrarContratosExpirados', () => {
    it('deve retornar 0 processados quando não há matrículas expiradas', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      const result = await encerrarContratosExpirados();

      expect(result.processados).toBe(0);
      expect(result.atualizados).toBe(0);
      expect(result.erros).toHaveLength(0);
    });

    it('deve processar matrículas expiradas corretamente', async () => {
      const ontem = new Date();
      ontem.setDate(ontem.getDate() - 1);

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

      const result = await encerrarContratosExpirados();

      expect(result.processados).toBe(2);
      expect(result.atualizados).toBe(2);
      expect(result.erros).toHaveLength(0);
    });

    it('deve filtrar por contaId quando informado', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      await encerrarContratosExpirados('conta-123');

      expect(prisma.matricula.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            aluno: { contaId: 'conta-123' },
          }),
        }),
      );
    });

    it('deve registrar erros quando transação falhar', async () => {
      const ontem = new Date();
      ontem.setDate(ontem.getDate() - 1);

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

      const result = await encerrarContratosExpirados();

      expect(result.processados).toBe(1);
      expect(result.atualizados).toBe(0);
      expect(result.erros).toHaveLength(1);
      expect(result.erros[0].matriculaId).toBe('matricula-1');
      expect(result.erros[0].erro).toBe('Erro de banco');
    });
  });

  describe('listarContratosProximosDeExpirar', () => {
    it('deve retornar lista vazia quando não há contratos próximos de expirar', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      const result = await listarContratosProximosDeExpirar('conta-123', 30);

      expect(result).toHaveLength(0);
    });

    it('deve calcular dias restantes corretamente', async () => {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      
      const em15Dias = new Date(hoje);
      em15Dias.setDate(em15Dias.getDate() + 15);

      vi.mocked(prisma.matricula.findMany).mockResolvedValue([
        {
          id: 'matricula-1',
          dataFimContrato: em15Dias,
          aluno: { nome: 'Aluno Teste' },
        },
      ] as never);

      const result = await listarContratosProximosDeExpirar('conta-123', 30);

      expect(result).toHaveLength(1);
      expect(result[0].diasRestantes).toBe(15);
      expect(result[0].alunoNome).toBe('Aluno Teste');
    });

    it('deve usar antecedência padrão de 30 dias', async () => {
      vi.mocked(prisma.matricula.findMany).mockResolvedValue([]);

      await listarContratosProximosDeExpirar('conta-123');

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
  });
});
