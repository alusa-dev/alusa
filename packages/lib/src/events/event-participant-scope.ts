import { Prisma, type PrismaClient } from '@prisma/client';

import { EventsError } from './events.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Matrículas que mantêm o aluno vinculado à turma para fins operacionais do evento. */
const EVENT_LINKED_MATRICULA_STATUSES = [
  'PENDENTE_TAXA',
  'AGUARDANDO_CONFIRMACAO',
  'ATIVA',
  'PAUSADA',
] as const;

export type EventScopedPerson = { id: string; nome: string };

export type EventScopedResources = {
  alunos: EventScopedPerson[];
  turmas: EventScopedPerson[];
  responsaveis: EventScopedPerson[];
};

type ActiveParticipantRow = {
  type: string;
  alunoId: string | null;
  turmaId: string | null;
  responsavelId: string | null;
};

function uniqueById(items: EventScopedPerson[]): EventScopedPerson[] {
  const seen = new Set<string>();
  const result: EventScopedPerson[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

function sortByNome(items: EventScopedPerson[]): EventScopedPerson[] {
  return [...items].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function loadActiveEventParticipants(
  db: DbClient,
  contaId: string,
  eventId: string,
): Promise<ActiveParticipantRow[]> {
  return db.eventParticipant.findMany({
    where: { contaId, eventId, cancelledAt: null },
    select: { type: true, alunoId: true, turmaId: true, responsavelId: true },
  });
}

export async function listEventScopedResources(
  db: DbClient,
  contaId: string,
  eventId: string,
): Promise<EventScopedResources> {
  const event = await db.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    select: { id: true },
  });
  if (!event) {
    throw new EventsError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.', 404);
  }

  const participants = await loadActiveEventParticipants(db, contaId, eventId);

  const alunoIds = [...new Set(
    participants.map((p) => p.alunoId).filter((id): id is string => Boolean(id)),
  )];

  const classTurmaIds = [...new Set(
    participants
      .filter((p) => p.type === 'CLASS' && p.turmaId)
      .map((p) => p.turmaId as string),
  )];

  const participantResponsavelIds = [...new Set(
    participants.map((p) => p.responsavelId).filter((id): id is string => Boolean(id)),
  )];

  const [alunos, classTurmas, matriculaTurmas, linkedResponsaveis] = await Promise.all([
    alunoIds.length > 0
      ? db.aluno.findMany({
          where: { contaId, id: { in: alunoIds } },
          select: { id: true, nome: true },
        })
      : [],
    classTurmaIds.length > 0
      ? db.turma.findMany({
          where: { contaId, id: { in: classTurmaIds } },
          select: { id: true, nome: true },
        })
      : [],
    alunoIds.length > 0
      ? db.matricula.findMany({
          where: {
            contaId,
            alunoId: { in: alunoIds },
            turmaId: { not: null },
            status: { in: [...EVENT_LINKED_MATRICULA_STATUSES] },
          },
          select: { turmaId: true },
          distinct: ['turmaId'],
        })
      : [],
    alunoIds.length > 0
      ? db.alunoResponsavel.findMany({
          where: { contaId, alunoId: { in: alunoIds } },
          select: { responsavel: { select: { id: true, nome: true } } },
        })
      : [],
  ]);

  const matriculaTurmaIds = matriculaTurmas
    .map((row) => row.turmaId)
    .filter((id): id is string => Boolean(id));

  const extraTurmas =
    matriculaTurmaIds.length > 0
      ? await db.turma.findMany({
          where: {
            contaId,
            id: { in: matriculaTurmaIds.filter((id) => !classTurmaIds.includes(id)) },
          },
          select: { id: true, nome: true },
        })
      : [];

  const responsavelFromLinks = linkedResponsaveis.map((row) => row.responsavel);
  const extraResponsavelIds = participantResponsavelIds.filter(
    (id) => !responsavelFromLinks.some((r) => r.id === id),
  );
  const participantResponsaveis =
    extraResponsavelIds.length > 0
      ? await db.responsavel.findMany({
          where: { contaId, id: { in: extraResponsavelIds } },
          select: { id: true, nome: true },
        })
      : [];

  return {
    alunos: sortByNome(uniqueById(alunos.map((a) => ({ id: a.id, nome: a.nome })))),
    turmas: sortByNome(
      uniqueById([
        ...classTurmas.map((t) => ({ id: t.id, nome: t.nome })),
        ...extraTurmas.map((t) => ({ id: t.id, nome: t.nome })),
      ]),
    ),
    responsaveis: sortByNome(
      uniqueById([
        ...responsavelFromLinks.map((r) => ({ id: r.id, nome: r.nome })),
        ...participantResponsaveis.map((r) => ({ id: r.id, nome: r.nome })),
      ]),
    ),
  };
}

export async function assertEventParticipantAluno(
  db: DbClient,
  contaId: string,
  eventId: string,
  alunoId: string | null | undefined,
  options?: { required?: boolean },
): Promise<void> {
  if (!alunoId) {
    if (options?.required) {
      throw new EventsError('ALUNO_OBRIGATORIO', 'Informe o aluno inscrito no evento.', 422);
    }
    return;
  }

  const participant = await db.eventParticipant.findFirst({
    where: { contaId, eventId, alunoId, cancelledAt: null },
    select: { id: true },
  });
  if (!participant) {
    throw new EventsError(
      'ALUNO_NAO_PARTICIPANTE',
      'Este aluno não está inscrito neste evento.',
      422,
    );
  }
}

export async function assertEventParticipantTurma(
  db: DbClient,
  contaId: string,
  eventId: string,
  turmaId: string | null | undefined,
): Promise<void> {
  if (!turmaId) return;

  const classParticipant = await db.eventParticipant.findFirst({
    where: { contaId, eventId, turmaId, type: 'CLASS', cancelledAt: null },
    select: { id: true },
  });
  if (classParticipant) return;

  const participants = await loadActiveEventParticipants(db, contaId, eventId);
  const alunoIds = participants.map((p) => p.alunoId).filter((id): id is string => Boolean(id));
  if (alunoIds.length === 0) {
    throw new EventsError(
      'TURMA_NAO_PARTICIPANTE',
      'Esta turma não está vinculada a participantes deste evento.',
      422,
    );
  }

  const matricula = await db.matricula.findFirst({
    where: {
      contaId,
      alunoId: { in: alunoIds },
      turmaId,
      status: { in: [...EVENT_LINKED_MATRICULA_STATUSES] },
    },
    select: { id: true },
  });
  if (!matricula) {
    throw new EventsError(
      'TURMA_NAO_PARTICIPANTE',
      'Esta turma não está vinculada a participantes deste evento.',
      422,
    );
  }
}

export async function assertEventParticipantResponsavel(
  db: DbClient,
  contaId: string,
  eventId: string,
  responsavelId: string | null | undefined,
): Promise<void> {
  if (!responsavelId) return;

  const asParticipant = await db.eventParticipant.findFirst({
    where: { contaId, eventId, responsavelId, cancelledAt: null },
    select: { id: true },
  });
  if (asParticipant) return;

  const participants = await loadActiveEventParticipants(db, contaId, eventId);
  const alunoIds = participants.map((p) => p.alunoId).filter((id): id is string => Boolean(id));
  if (alunoIds.length === 0) {
    throw new EventsError(
      'RESPONSAVEL_NAO_PARTICIPANTE',
      'Este responsável não está vinculado a participantes deste evento.',
      422,
    );
  }

  const link = await db.alunoResponsavel.findFirst({
    where: { contaId, responsavelId, alunoId: { in: alunoIds } },
    select: { id: true },
  });
  if (!link) {
    throw new EventsError(
      'RESPONSAVEL_NAO_PARTICIPANTE',
      'Este responsável não está vinculado a participantes deste evento.',
      422,
    );
  }
}

export async function assertEventScopedAssignmentLinks(
  db: DbClient,
  contaId: string,
  eventId: string,
  input: {
    alunoId?: string | null;
    turmaId?: string | null;
    requireAluno?: boolean;
  },
): Promise<void> {
  await assertEventParticipantAluno(db, contaId, eventId, input.alunoId, {
    required: input.requireAluno,
  });
  await assertEventParticipantTurma(db, contaId, eventId, input.turmaId);
}

export async function assertEventScopedTicketSaleLinks(
  db: DbClient,
  contaId: string,
  eventId: string,
  input: { alunoId?: string | null; responsavelId?: string | null },
): Promise<void> {
  await assertEventParticipantAluno(db, contaId, eventId, input.alunoId);
  await assertEventParticipantResponsavel(db, contaId, eventId, input.responsavelId);
}
