import type { AulasLookupItemDTO, AulasTurmaLookupItemDTO } from '@/features/aulas/dtos';
import { requestJson } from '@/features/aulas/calendar/services/aulas-api';

export type AgendaResourcesResult = {
  turmas: AulasTurmaLookupItemDTO[];
  professores: AulasLookupItemDTO[];
  salas: AulasLookupItemDTO[];
  alunos?: AulasLookupItemDTO[];
};

const AGENDA_RESOURCES_CACHE_TTL_MS = 5 * 60_000;

const agendaResourcesCache = new Map<string, { expiresAt: number; value: AgendaResourcesResult }>();
const agendaResourcesInFlight = new Map<string, Promise<AgendaResourcesResult>>();

function getAgendaResourcesCacheKey(options?: { includeAlunos?: boolean }) {
  return options?.includeAlunos ? 'with-alunos' : 'default';
}

export function invalidateAgendaResourcesCache() {
  agendaResourcesCache.clear();
  agendaResourcesInFlight.clear();
}

export async function listAgendaResources(options?: { includeAlunos?: boolean }) {
  const cacheKey = getAgendaResourcesCacheKey(options);
  const cached = agendaResourcesCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inFlight = agendaResourcesInFlight.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  const search = new URLSearchParams();

  if (options?.includeAlunos) {
    search.set('includeAlunos', 'true');
  }

  const request = requestJson<AgendaResourcesResult>(`/api/aulas/resources?${search.toString()}`).then((result) => {
    agendaResourcesCache.set(cacheKey, {
      expiresAt: Date.now() + AGENDA_RESOURCES_CACHE_TTL_MS,
      value: result,
    });

    return result;
  });

  agendaResourcesInFlight.set(cacheKey, request);

  try {
    return await request;
  } finally {
    agendaResourcesInFlight.delete(cacheKey);
  }
}