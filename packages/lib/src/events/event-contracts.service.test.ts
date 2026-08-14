import { describe, expect, it, vi } from 'vitest';
import { createEventContractForParticipant } from './event-contracts.service';

describe('contratos de eventos', () => {
  it('não cria contrato quando o evento não escolheu modelo', async () => {
    const tx = {
      eventParticipant: {
        findFirst: vi.fn().mockResolvedValue({
          event: { id: 'event-1', name: 'Mostra', contratoModeloId: null },
          aluno: { id: 'aluno-1', nome: 'Aluno', cpf: null, responsaveis: [] },
        }),
      },
      eventoContrato: { findFirst: vi.fn(), create: vi.fn() },
    } as never;

    const result = await createEventContractForParticipant(tx, {
      contaId: 'conta-1',
      userId: 'user-1',
      eventId: 'event-1',
      participantId: 'participant-1',
      alunoId: 'aluno-1',
    });

    expect(result).toBeNull();
  });

  it('é idempotente para a mesma inscrição', async () => {
    const existing = { id: 'event-contract-1', status: 'PENDENTE' };
    const tx = {
      eventParticipant: {
        findFirst: vi.fn().mockResolvedValue({
          event: { id: 'event-1', name: 'Mostra', contratoModeloId: 'model-1' },
          aluno: { id: 'aluno-1', nome: 'Aluno', cpf: null, responsaveis: [] },
        }),
      },
      eventoContrato: { findFirst: vi.fn().mockResolvedValue(existing), create: vi.fn() },
    } as never;

    const result = await createEventContractForParticipant(tx, {
      contaId: 'conta-1',
      userId: 'user-1',
      eventId: 'event-1',
      participantId: 'participant-1',
      alunoId: 'aluno-1',
    });

    expect(result).toBe(existing);
    expect((tx as any).eventoContrato.create).not.toHaveBeenCalled();
  });
});
