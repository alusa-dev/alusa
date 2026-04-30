import { StatusMatricula } from '@prisma/client';
import {
  MATRICULA_STATUSES_TO_CANCEL,
  executeAlunoArchivePolicy,
  previewAlunoArchive,
} from './aluno-archive.policy';

describe('aluno-archive.policy', () => {
  describe('MATRICULA_STATUSES_TO_CANCEL', () => {
    it('inclui ATIVA', () => {
      expect(MATRICULA_STATUSES_TO_CANCEL).toContain(StatusMatricula.ATIVA);
    });

    it('inclui PENDENTE_TAXA', () => {
      expect(MATRICULA_STATUSES_TO_CANCEL).toContain(StatusMatricula.PENDENTE_TAXA);
    });

    it('inclui AGUARDANDO_CONFIRMACAO', () => {
      expect(MATRICULA_STATUSES_TO_CANCEL).toContain(StatusMatricula.AGUARDANDO_CONFIRMACAO);
    });

    it('inclui PAUSADA', () => {
      expect(MATRICULA_STATUSES_TO_CANCEL).toContain('PAUSADA');
    });

    it('não inclui CANCELADA', () => {
      expect(MATRICULA_STATUSES_TO_CANCEL).not.toContain(StatusMatricula.CANCELADA);
    });

    it('não inclui RECUSADA', () => {
      expect(MATRICULA_STATUSES_TO_CANCEL).not.toContain(StatusMatricula.RECUSADA);
    });
  });

  describe('executeAlunoArchivePolicy', () => {
    const mockPrisma = {
      aluno: {
        findFirst: vi.fn(),
      },
      matricula: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('lança erro se aluno não encontrado', async () => {
      mockPrisma.aluno.findFirst.mockResolvedValue(null);

      await expect(
        executeAlunoArchivePolicy('aluno-1', 'conta-1', {
          prisma: mockPrisma as any,
        }),
      ).rejects.toThrow('Aluno não encontrado');
    });

    it('retorna resultado vazio se aluno não tem matrículas ativas', async () => {
      mockPrisma.aluno.findFirst.mockResolvedValue({
        id: 'aluno-1',
        status: 'ATIVO',
        nome: 'João',
      });
      mockPrisma.matricula.findMany.mockResolvedValue([]);

      const result = await executeAlunoArchivePolicy('aluno-1', 'conta-1', {
        prisma: mockPrisma as any,
      });

      expect(result.archived).toBe(true);
      expect(result.totalMatriculasProcessed).toBe(0);
      expect(result.totalMatriculasCancelled).toBe(0);
    });

    it('cancela matrículas ativas com fallback local', async () => {
      mockPrisma.aluno.findFirst.mockResolvedValue({
        id: 'aluno-1',
        status: 'ATIVO',
        nome: 'João',
      });
      mockPrisma.matricula.findMany.mockResolvedValue([
        { id: 'mat-1', status: 'ATIVA', asaasSubscriptionId: null },
        { id: 'mat-2', status: 'PENDENTE_TAXA', asaasSubscriptionId: null },
      ]);
      mockPrisma.matricula.update.mockResolvedValue({});

      const result = await executeAlunoArchivePolicy('aluno-1', 'conta-1', {
        prisma: mockPrisma as any,
      });

      expect(result.archived).toBe(true);
      expect(result.totalMatriculasProcessed).toBe(2);
      expect(result.totalMatriculasCancelled).toBe(2);
      expect(mockPrisma.matricula.update).toHaveBeenCalledTimes(2);
    });

    it('usa syncMatriculaStatus quando injetado', async () => {
      const mockSync = vi.fn().mockResolvedValue({});

      mockPrisma.aluno.findFirst.mockResolvedValue({
        id: 'aluno-1',
        status: 'ATIVO',
        nome: 'João',
      });
      mockPrisma.matricula.findMany.mockResolvedValue([
        { id: 'mat-1', status: 'ATIVA', asaasSubscriptionId: 'sub-123' },
      ]);

      const result = await executeAlunoArchivePolicy('aluno-1', 'conta-1', {
        prisma: mockPrisma as any,
        syncMatriculaStatus: mockSync,
      });

      expect(mockSync).toHaveBeenCalledWith({
        prisma: mockPrisma,
        matriculaId: 'mat-1',
        contaId: 'conta-1',
        targetStatus: 'CANCELADA',
        actorId: 'system',
        motivo: 'Aluno arquivado - matrículas canceladas automaticamente',
      });
      expect(result.matriculasCancelled[0].asaasAction).toBe('DELETE');
    });

    it('registra erro quando sync falha', async () => {
      const mockSync = vi.fn().mockRejectedValue(new Error('Asaas offline'));

      mockPrisma.aluno.findFirst.mockResolvedValue({
        id: 'aluno-1',
        status: 'ATIVO',
        nome: 'João',
      });
      mockPrisma.matricula.findMany.mockResolvedValue([
        { id: 'mat-1', status: 'ATIVA', asaasSubscriptionId: 'sub-123' },
      ]);

      const result = await executeAlunoArchivePolicy('aluno-1', 'conta-1', {
        prisma: mockPrisma as any,
        syncMatriculaStatus: mockSync,
      });

      expect(result.totalErrors).toBe(1);
      expect(result.matriculasCancelled[0].asaasAction).toBe('ERROR');
      expect(result.matriculasCancelled[0].error).toBe('Asaas offline');
    });
  });

  describe('previewAlunoArchive', () => {
    const mockPrisma = {
      aluno: {
        findFirst: vi.fn(),
      },
      matricula: {
        findMany: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('retorna preview sem executar cancelamentos', async () => {
      mockPrisma.aluno.findFirst.mockResolvedValue({
        id: 'aluno-1',
        status: 'ATIVO',
        nome: 'João',
      });
      mockPrisma.matricula.findMany.mockResolvedValue([
        { id: 'mat-1', status: 'ATIVA', asaasSubscriptionId: 'sub-123' },
        { id: 'mat-2', status: 'PAUSADA', asaasSubscriptionId: null },
      ]);

      const result = await previewAlunoArchive('aluno-1', 'conta-1', {
        prisma: mockPrisma as any,
      });

      expect(result.archived).toBe(false);
      expect(result.totalMatriculasProcessed).toBe(2);
      expect(result.totalMatriculasCancelled).toBe(0);
      expect(result.matriculasCancelled[0].cancelled).toBe(false);
      expect(result.matriculasCancelled[0].asaasAction).toBe('DELETE');
      expect(result.matriculasCancelled[1].asaasAction).toBe('LOCAL_ONLY');
    });
  });
});
