import type {
  CalendarEventDetailsResultDTO,
  CreateCalendarEventInputDTO,
  ListCalendarEventsQueryDTO,
  SaveAttendanceInputDTO,
  UpdateCalendarEventInputDTO,
} from '@/features/aulas/dtos';
import { canAccessAulas, resolveAulasAccessScope, type AulasSessionUser } from '@/src/server/aulas/session';
import {
  createAgendaEvent,
  getAgendaEventDetails,
  listAgendaEvents,
  listAgendaResources,
  updateAgendaEvent,
} from '@/src/server/aulas/agenda/agenda.service';
import {
  getAttendanceEventDetails,
  saveAttendanceForEvent,
} from '@/src/server/aulas/frequencia/attendance.service';
import { assertAulasWriteAccess } from '@/src/server/aulas/session';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';
import { AulasError } from '@/src/server/aulas/aulas-error';

export type MobileAgendaActor = {
  userId: string;
  contaId: string;
};

export class MobileAgendaUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileAgendaUnauthorizedError';
  }
}

export class MobileAgendaForbiddenError extends Error {
  constructor(message = 'Você não tem permissão para acessar a agenda.') {
    super(message);
    this.name = 'MobileAgendaForbiddenError';
  }
}

export class MobileAgendaNotFoundError extends Error {
  constructor() {
    super('Evento não encontrado.');
    this.name = 'MobileAgendaNotFoundError';
  }
}

type AuthorizedAgendaUser = {
  user: AulasSessionUser;
  professorId: string | null;
  isProfessor: boolean;
};

type AgendaResourceReferences = {
  turmaId?: string | null;
  salaId?: string | null;
  professorIds?: string[];
};

async function assertAgendaReferencesBelongToConta(
  contaId: string,
  references: AgendaResourceReferences,
) {
  const professorIds = [...new Set((references.professorIds ?? []).filter(Boolean))];
  const turmaId = references.turmaId?.trim() || null;
  const salaId = references.salaId?.trim() || null;

  const [turma, sala, professores] = await runWithTenant(contaId, async (tx: TenantTransactionClient) =>
    Promise.all([
      turmaId
        ? tx.turma.findFirst({ where: { id: turmaId, contaId }, select: { id: true } })
        : null,
      salaId
        ? tx.sala.findFirst({ where: { id: salaId, contaId }, select: { id: true } })
        : null,
      professorIds.length
        ? tx.professor.findMany({
            where: { id: { in: professorIds }, contaId },
            select: { id: true },
          })
        : [],
    ]),
  );

  if (turmaId && !turma) {
    throw new MobileAgendaForbiddenError('A turma selecionada não está disponível.');
  }

  if (salaId && !sala) {
    throw new MobileAgendaForbiddenError('A sala selecionada não está disponível.');
  }

  if (professores.length !== professorIds.length) {
    throw new MobileAgendaForbiddenError('Um dos professores selecionados não está disponível.');
  }
}

async function loadAuthorizedUser(actor: MobileAgendaActor): Promise<AulasSessionUser> {
  const normalizedUserId = actor.userId.trim();
  const normalizedContaId = actor.contaId.trim();

  if (!normalizedUserId || !normalizedContaId) {
    throw new MobileAgendaUnauthorizedError();
  }

  return runWithTenant(normalizedContaId, async (tx: TenantTransactionClient) => {
    const membership = await tx.usuarioConta.findFirst({
      where: {
        usuarioId: normalizedUserId,
        contaId: normalizedContaId,
        status: 'ATIVO',
        usuario: { status: 'ATIVO' },
        conta: { status: 'ATIVO', deletedAt: null },
      },
      select: {
        role: true,
        usuario: { select: { email: true } },
      },
    });

    if (!membership) throw new MobileAgendaUnauthorizedError();

    return {
      id: normalizedUserId,
      contaId: normalizedContaId,
      role: String(membership.role).toUpperCase(),
      email: membership.usuario.email,
    };
  });
}

async function authorize(actor: MobileAgendaActor, options?: { write?: boolean }): Promise<AuthorizedAgendaUser> {
  const user = await loadAuthorizedUser(actor);
  if (!canAccessAulas(user)) throw new MobileAgendaForbiddenError();
  if (options?.write) await assertAulasWriteAccess(user);

  const scope = await resolveAulasAccessScope(user);
  return {
    user,
    professorId: scope.professorId,
    isProfessor: scope.isProfessor,
  };
}

function applyProfessorScope(
  query: ListCalendarEventsQueryDTO,
  authorized: AuthorizedAgendaUser,
): ListCalendarEventsQueryDTO {
  if (!authorized.isProfessor) return query;

  // Sem vínculo com Professor, nunca ampliamos a consulta para a conta inteira.
  return {
    ...query,
    professorId: authorized.professorId ?? '__NO_PROFESSOR_LINK__',
  };
}

function assertProfessorEventAccess(
  result: CalendarEventDetailsResultDTO,
  authorized: AuthorizedAgendaUser,
) {
  if (
    authorized.isProfessor &&
    (!authorized.professorId || !result.data.professores.some((professor) => professor.id === authorized.professorId))
  ) {
    throw new MobileAgendaNotFoundError();
  }
}

async function getAgendaEventOrNotFound(contaId: string, eventId: string) {
  try {
    return await getAgendaEventDetails(contaId, eventId);
  } catch (error) {
    if (error instanceof AulasError && error.code === 'EVENTO_NAO_ENCONTRADO') {
      throw new MobileAgendaNotFoundError();
    }
    throw error;
  }
}

export async function listMobileAgendaEvents(
  actor: MobileAgendaActor,
  query: ListCalendarEventsQueryDTO,
) {
  const authorized = await authorize(actor);
  return listAgendaEvents(actor.contaId, applyProfessorScope(query, authorized));
}

export async function getMobileAgendaEvent(actor: MobileAgendaActor, eventId: string) {
  const authorized = await authorize(actor);
  const result = await getAgendaEventOrNotFound(actor.contaId, eventId.trim());
  assertProfessorEventAccess(result, authorized);
  return result;
}

export async function createMobileAgendaEvent(
  actor: MobileAgendaActor,
  input: CreateCalendarEventInputDTO,
) {
  await authorize(actor, { write: true });
  await assertAgendaReferencesBelongToConta(actor.contaId, input);
  return createAgendaEvent(actor.contaId, input);
}

export async function updateMobileAgendaEvent(
  actor: MobileAgendaActor,
  eventId: string,
  input: UpdateCalendarEventInputDTO,
) {
  const authorized = await authorize(actor, { write: true });
  const current = await getAgendaEventOrNotFound(actor.contaId, eventId.trim());
  assertProfessorEventAccess(current, authorized);
  await assertAgendaReferencesBelongToConta(actor.contaId, input);
  return updateAgendaEvent(actor.contaId, eventId.trim(), input);
}

export async function listMobileAgendaResources(actor: MobileAgendaActor) {
  const authorized = await authorize(actor);
  const resources = await listAgendaResources(actor.contaId);

  if (!authorized.isProfessor || !authorized.professorId) {
    return resources;
  }

  const visibleTurmas = resources.turmas.filter((turma) =>
    turma.defaultSchedule?.professorIds.includes(authorized.professorId!),
  );
  const visibleSalaIds = new Set(
    visibleTurmas
      .map((turma) => turma.defaultSchedule?.salaId)
      .filter((id): id is string => Boolean(id)),
  );

  return {
    turmas: visibleTurmas,
    professores: resources.professores.filter((professor) => professor.id === authorized.professorId),
    salas: resources.salas.filter((sala) => visibleSalaIds.has(sala.id)),
  };
}

export async function getMobileAttendanceDetails(actor: MobileAgendaActor, eventId: string) {
  const authorized = await authorize(actor);
  const event = await getAgendaEventOrNotFound(actor.contaId, eventId.trim());
  assertProfessorEventAccess(event, authorized);

  if (event.data.type !== 'AULA' && event.data.type !== 'REPOSICAO') {
    throw new MobileAgendaForbiddenError('A frequência está disponível apenas para aulas e reposições.');
  }

  return getAttendanceEventDetails(actor.contaId, eventId.trim());
}

export async function saveMobileAttendance(
  actor: MobileAgendaActor,
  eventId: string,
  input: SaveAttendanceInputDTO,
) {
  const authorized = await authorize(actor, { write: true });
  const event = await getAgendaEventOrNotFound(actor.contaId, eventId.trim());
  assertProfessorEventAccess(event, authorized);

  if (event.data.type !== 'AULA' && event.data.type !== 'REPOSICAO') {
    throw new MobileAgendaForbiddenError('A frequência está disponível apenas para aulas e reposições.');
  }

  return saveAttendanceForEvent(actor.contaId, eventId.trim(), actor.userId, input);
}
