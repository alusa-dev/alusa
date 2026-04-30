import { describe, expect, it } from 'vitest';
import { mapContratoModeloRecordToDTO, mapContratoRecordToDTO } from '@/features/contratos/mappers';

describe('contratos DTO mappers', () => {
  it('mapeia contrato hidratado para DTO canônico', () => {
    const dto = mapContratoRecordToDTO({
      id: 'ctr_1',
      matriculaId: 'mat_1',
      modeloId: 'mod_1',
      contratoOrigemId: null,
      arquivoPdfUrl: '/uploads/contrato.pdf',
      hashPdf: 'hash_pdf',
      status: 'PENDENTE',
      assinadoPor: null,
      assinadoEmail: null,
      assinadoCpf: null,
      assinadoIp: null,
      assinadoEm: null,
      assinadoUserAgent: null,
      hashAssinatura: null,
      tokenPublico: 'token_123',
      tokenExpiraEm: new Date('2026-01-10T12:00:00.000Z'),
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      updatedAt: new Date('2026-01-02T12:00:00.000Z'),
      modelo: {
        id: 'mod_1',
        nome: 'Contrato padrão',
      },
      matricula: {
        id: 'mat_1',
        contratoAtualId: 'ctr_1',
        aluno: {
          id: 'alu_1',
          nome: 'Maria',
          cpf: '12345678901',
        },
        turma: {
          id: 'tur_1',
          nome: 'Turma A',
        },
      },
    });

    expect(dto.matricula.aluno.nome).toBe('Maria');
    expect(dto.modelo?.nome).toBe('Contrato padrão');
    expect(dto.tokenExpiraEm).toBe('2026-01-10T12:00:00.000Z');
  });

  it('mapeia modelo de contrato com contador', () => {
    const dto = mapContratoModeloRecordToDTO({
      id: 'mod_1',
      contaId: 'conta_1',
      nome: 'Modelo 2026',
      descricao: 'Descrição',
      arquivoOriginalUrl: '/uploads/original.pdf',
      arquivoPdfUrl: '/uploads/gerado.pdf',
      mimeType: 'application/pdf',
      hashSha256: 'a'.repeat(64),
      tamanhoBytes: 1024,
      versao: 2,
      status: 'ATIVO',
      createdAt: new Date('2026-01-01T12:00:00.000Z'),
      updatedAt: new Date('2026-01-02T12:00:00.000Z'),
      _count: { contratos: 3 },
    });

    expect(dto._count?.contratos).toBe(3);
    expect(dto.arquivoOriginalUrl).toBe('/uploads/original.pdf');
  });
});
