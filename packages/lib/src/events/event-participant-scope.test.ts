import { describe, expect, it, vi } from 'vitest';

import {
  assertEventScopedAssignmentLinks,
  assertEventScopedTicketSaleLinks,
  listEventScopedResources,
} from './event-participant-scope';
import { EventsError } from './events.service';

type MockDb = {
  schoolEvent: { findFirst: ReturnType<typeof vi.fn> };
  eventParticipant: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  aluno: { findMany: ReturnType<typeof vi.fn> };
  turma: { findMany: ReturnType<typeof vi.fn> };
  matricula: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  alunoResponsavel: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  responsavel: { findMany: ReturnType<typeof vi.fn> };
};

function createMockDb(): MockDb {
  return {
    schoolEvent: { findFirst: vi.fn() },
    eventParticipant: { findMany: vi.fn(), findFirst: vi.fn() },
    aluno: { findMany: vi.fn() },
    turma: { findMany: vi.fn() },
    matricula: { findMany: vi.fn(), findFirst: vi.fn() },
    alunoResponsavel: { findMany: vi.fn(), findFirst: vi.fn() },
    responsavel: { findMany: vi.fn() },
  };
}

describe('listEventScopedResources', () => {
  it('returns only enrolled students and linked turmas/responsaveis', async () => {
    const db = createMockDb();
    db.schoolEvent.findFirst.mockResolvedValue({ id: 'event-1' });
    db.eventParticipant.findMany.mockResolvedValue([
      { type: 'STUDENT', alunoId: 'aluno-1', turmaId: null, responsavelId: null },
      { type: 'CLASS', alunoId: null, turmaId: 'turma-class', responsavelId: null },
    ]);
    db.aluno.findMany.mockResolvedValue([{ id: 'aluno-1', nome: 'Ana' }]);
    db.turma.findMany
      .mockResolvedValueOnce([{ id: 'turma-class', nome: 'Turma A' }])
      .mockResolvedValueOnce([{ id: 'turma-mat', nome: 'Turma B' }]);
    db.matricula.findMany.mockResolvedValue([{ turmaId: 'turma-mat' }]);
    db.alunoResponsavel.findMany.mockResolvedValue([
      { responsavel: { id: 'resp-1', nome: 'Maria' } },
    ]);
    db.responsavel.findMany.mockResolvedValue([]);

    const result = await listEventScopedResources(db as never, 'conta-1', 'event-1');

    expect(result.alunos).toEqual([{ id: 'aluno-1', nome: 'Ana' }]);
    expect(result.turmas.map((t) => t.id)).toEqual(expect.arrayContaining(['turma-class', 'turma-mat']));
    expect(result.responsaveis).toEqual([{ id: 'resp-1', nome: 'Maria' }]);
  });

  it('throws when event does not exist', async () => {
    const db = createMockDb();
    db.schoolEvent.findFirst.mockResolvedValue(null);

    await expect(listEventScopedResources(db as never, 'conta-1', 'missing')).rejects.toMatchObject({
      code: 'EVENTO_NAO_ENCONTRADO',
    });
  });
});

describe('assertEventScopedAssignmentLinks', () => {
  it('rejects aluno not enrolled in the event', async () => {
    const db = createMockDb();
    db.eventParticipant.findFirst.mockResolvedValue(null);

    await expect(
      assertEventScopedAssignmentLinks(db as never, 'conta-1', 'event-1', { alunoId: 'aluno-x' }),
    ).rejects.toMatchObject({ code: 'ALUNO_NAO_PARTICIPANTE' });
  });

  it('accepts enrolled aluno', async () => {
    const db = createMockDb();
    db.eventParticipant.findFirst.mockResolvedValue({ id: 'part-1' });

    await assertEventScopedAssignmentLinks(db as never, 'conta-1', 'event-1', { alunoId: 'aluno-1' });
  });
});

describe('assertEventScopedTicketSaleLinks', () => {
  it('rejects responsavel without link to enrolled students', async () => {
    const db = createMockDb();
    db.eventParticipant.findFirst.mockResolvedValue(null);
    db.eventParticipant.findMany.mockResolvedValue([
      { type: 'STUDENT', alunoId: 'aluno-1', turmaId: null, responsavelId: null },
    ]);
    db.alunoResponsavel.findFirst.mockResolvedValue(null);

    await expect(
      assertEventScopedTicketSaleLinks(db as never, 'conta-1', 'event-1', { responsavelId: 'resp-x' }),
    ).rejects.toBeInstanceOf(EventsError);
  });
});
