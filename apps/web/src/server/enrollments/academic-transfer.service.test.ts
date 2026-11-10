import { describe, expect, it, vi } from 'vitest';
import {
  AcademicTransferError,
  formalizePendingAcademicTransfer,
  registerPendingAcademicTransfer,
} from './academic-transfer.service';

describe('academic-transfer.service', () => {
  it('records concrete pending evidence and keeps the destination indeterminate with audit', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'transfer-1', status: 'PENDENTE' });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = {
      matriculaVinculoAcademico: { findFirst: vi.fn()
        .mockResolvedValueOnce({ id: 'source-1', modalidadeId: 'course-a', vigenciaIniciadaEm: new Date(), matricula: { alunoId: 'student-1' } })
        .mockResolvedValueOnce({ id: 'destination-1', modalidadeId: 'course-b', classificacao: 'PRIMEIRO_INGRESSO', matricula: { alunoId: 'student-1' } }), updateMany },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue(null), create },
      matriculaClassificacaoAudit: { create: auditCreate },
    };

    const result = await registerPendingAcademicTransfer({
      tx: tx as never, contaId: 'tenant-a', sourceLinkId: 'source-1', destinationLinkId: 'destination-1',
      reason: 'Documentos de transferência recebidos.', actorId: 'admin-1',
    });

    expect(result).toMatchObject({ id: 'transfer-1', status: 'PENDENTE' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      contaId: 'tenant-a', origemVinculoId: 'source-1', destinoVinculoId: 'destination-1',
      status: 'PENDENTE', motivo: 'Documentos de transferência recebidos.', solicitadaPor: 'admin-1',
    }) });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'destination-1', contaId: 'tenant-a', classificacao: 'PRIMEIRO_INGRESSO' },
      data: expect.objectContaining({ classificacao: 'HISTORICO_INDETERMINADO' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      contaId: 'tenant-a', vinculoAcademicoId: 'destination-1', de: 'PRIMEIRO_INGRESSO',
      para: 'HISTORICO_INDETERMINADO', autorId: 'admin-1',
    }) });
    expect(tx.matriculaVinculoAcademico.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: 'source-1', contaId: 'tenant-a' } }));
    expect(tx.matriculaVinculoAcademico.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: 'destination-1', contaId: 'tenant-a' } }));
  });

  it('formalizes only a pending valid transfer and atomically updates status, classification and audit', async () => {
    const relationUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const linkUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-2' });
    const tx = {
      transferenciaAcademicaVinculo: {
        findFirst: vi.fn().mockResolvedValueOnce({
          id: 'transfer-1', origemVinculoId: 'source-1', destinoVinculoId: 'destination-1',
          motivo: 'Documentos de transferência recebidos.', status: 'PENDENTE',
        }).mockResolvedValueOnce(null),
        updateMany: relationUpdate,
      },
      matriculaVinculoAcademico: { findFirst: vi.fn()
        .mockResolvedValueOnce({ id: 'source-1', modalidadeId: 'course-a', vigenciaIniciadaEm: new Date(), matricula: { alunoId: 'student-1' } })
        .mockResolvedValueOnce({ id: 'destination-1', modalidadeId: 'course-b', cicloAcademicoId: 'cycle-b', classificacao: 'HISTORICO_INDETERMINADO', matricula: { alunoId: 'student-1' } }), updateMany: linkUpdate },
      matriculaClassificacaoAudit: { create: auditCreate },
    };

    const result = await formalizePendingAcademicTransfer({
      tx: tx as never, contaId: 'tenant-a', destinationLinkId: 'destination-1', actorId: 'admin-2',
    });

    expect(result).toMatchObject({ status: 'FORMALIZADA', formalizadaPor: 'admin-2' });
    expect(relationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'transfer-1', contaId: 'tenant-a', status: 'PENDENTE' },
      data: expect.objectContaining({ status: 'FORMALIZADA', formalizadaPor: 'admin-2' }),
    }));
    expect(linkUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'destination-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' },
      data: expect.objectContaining({ classificacao: 'TRANSFERENCIA', classificacaoOrigem: 'TRANSFERENCIA_FORMAL' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      de: 'HISTORICO_INDETERMINADO', para: 'TRANSFERENCIA', motivo: 'Documentos de transferência recebidos.', autorId: 'admin-2',
    }) });
  });

  it('does not formalize or write audit when the compare-and-update loses a race', async () => {
    const relationUpdate = vi.fn().mockResolvedValue({ count: 0 });
    const linkUpdate = vi.fn();
    const auditCreate = vi.fn();
    const tx = {
      transferenciaAcademicaVinculo: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: 'transfer-1', origemVinculoId: 'source-1', destinoVinculoId: 'destination-1', motivo: 'Reason', status: 'PENDENTE' }).mockResolvedValueOnce(null),
        updateMany: relationUpdate,
      },
      matriculaVinculoAcademico: { findFirst: vi.fn()
        .mockResolvedValueOnce({ id: 'source-1', modalidadeId: 'course-a', vigenciaIniciadaEm: new Date(), matricula: { alunoId: 'student-1' } })
        .mockResolvedValueOnce({ id: 'destination-1', modalidadeId: 'course-b', cicloAcademicoId: 'cycle-b', classificacao: 'HISTORICO_INDETERMINADO', matricula: { alunoId: 'student-1' } }), updateMany: linkUpdate },
      matriculaClassificacaoAudit: { create: auditCreate },
    };

    await expect(formalizePendingAcademicTransfer({
      tx: tx as never, contaId: 'tenant-a', destinationLinkId: 'destination-1', actorId: 'admin-2',
    })).rejects.toMatchObject({ code: 'TRANSFERENCIA_CONCORRENTE', statusCode: 409 } satisfies Partial<AcademicTransferError>);
    expect(linkUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
