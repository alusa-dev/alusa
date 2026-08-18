import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../prisma';
import { permanentlyDeleteEventParticipant } from './events.service';

function createTransactionMock() {
  return {
    eventParticipant: {
      findFirst: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    eventoContrato: {
      findMany: vi.fn().mockResolvedValue([{ id: 'contract-1' }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    eventoContratoDocumento: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    eventoContratoEvidence: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    consentRecord: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    eventAudit: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
    },
  };
}

describe('permanentlyDeleteEventParticipant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exclui inscrição, contrato, consentimentos e registra auditoria mesmo com histórico', async () => {
    const tx = createTransactionMock();
    tx.eventParticipant.findFirst.mockResolvedValue({
      id: 'participant-1',
      contaId: 'conta-1',
      eventId: 'event-1',
      displayName: 'Nicole de Alencar Bezerra',
      cancelledAt: new Date('2026-08-18T00:00:00.000Z'),
      event: { id: 'event-1', name: 'Festival', status: 'ACTIVE' },
      aluno: { id: 'aluno-1', nome: 'Nicole de Alencar Bezerra', cpf: null },
      responsavel: null,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(permanentlyDeleteEventParticipant(
      { contaId: 'conta-1', userId: 'admin-1' },
      'event-1',
      'participant-1',
      {
        confirmation: 'EXCLUIR',
        motivo: 'Inscrição criada para teste',
      },
    )).resolves.toEqual({ ok: true });

    expect(tx.eventAudit.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.consentRecord.deleteMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        OR: [{ source: { startsWith: 'EVENT_CONTRACT:contract-1:' } }],
      },
    });
    expect(tx.eventoContratoDocumento.deleteMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', eventoContratoId: { in: ['contract-1'] } },
    });
    expect(tx.eventoContratoEvidence.deleteMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', eventoContratoId: { in: ['contract-1'] } },
    });
    expect(tx.eventoContrato.deleteMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', eventId: 'event-1', participantId: 'participant-1' },
    });
    expect(tx.eventParticipant.deleteMany).toHaveBeenCalledWith({
      where: { id: 'participant-1', contaId: 'conta-1', eventId: 'event-1' },
    });
  });

  it('não exclui inscrição ativa', async () => {
    const tx = createTransactionMock();
    tx.eventParticipant.findFirst.mockResolvedValue({
      id: 'participant-1',
      displayName: 'Nicole',
      cancelledAt: null,
      event: { id: 'event-1', name: 'Festival', status: 'ACTIVE' },
      aluno: { id: 'aluno-1', nome: 'Nicole', cpf: null },
      responsavel: null,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(permanentlyDeleteEventParticipant(
      { contaId: 'conta-1', userId: 'admin-1' },
      'event-1',
      'participant-1',
      { confirmation: 'REMOVER', motivo: 'Teste' },
    )).rejects.toMatchObject({ code: 'PARTICIPANTE_NAO_CANCELADO' });

    expect(tx.eventParticipant.deleteMany).not.toHaveBeenCalled();
    expect(tx.eventAudit.create).not.toHaveBeenCalled();
  });

  it('rejeita confirmação diferente do nome da inscrição', async () => {
    const tx = createTransactionMock();
    tx.eventParticipant.findFirst.mockResolvedValue({
      id: 'participant-1',
      displayName: 'Nicole',
      cancelledAt: new Date('2026-08-18T00:00:00.000Z'),
      event: { id: 'event-1', name: 'Festival', status: 'ACTIVE' },
      aluno: { id: 'aluno-1', nome: 'Nicole', cpf: null },
      responsavel: null,
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await expect(permanentlyDeleteEventParticipant(
      { contaId: 'conta-1', userId: 'admin-1' },
      'event-1',
      'participant-1',
      { confirmation: 'EXCLUIR OUTRA PESSOA', motivo: 'Teste' },
    )).rejects.toMatchObject({ code: 'CONFIRMACAO_INVALIDA' });

    expect(tx.eventParticipant.deleteMany).not.toHaveBeenCalled();
  });
});
