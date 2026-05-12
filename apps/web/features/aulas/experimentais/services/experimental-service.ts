import { listAlunosResultDTOSchema } from '@/features/cadastro/alunos/dtos';
import type {
  CreateExperimentalClassInputDTO,
  UpdateExperimentalClassInputDTO,
} from '@/features/aulas/dtos';
import { invalidateAgendaEventsCache } from '@/features/aulas/agenda/services/agenda-service';
import { mapExperimentalClassDetailsResult } from '@/features/aulas/mappers';
import { requestJson } from '@/features/aulas/calendar/services/aulas-api';

export async function createExperimentalClass(input: CreateExperimentalClassInputDTO) {
  const result = await requestJson<Record<string, unknown>>('/api/aulas/experimentais', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  invalidateAgendaEventsCache();

  return mapExperimentalClassDetailsResult(result);
}

export async function updateExperimentalClass(id: string, input: UpdateExperimentalClassInputDTO) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/experimentais/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  invalidateAgendaEventsCache();

  return mapExperimentalClassDetailsResult(result);
}

export async function searchExperimentalStudents(query: string) {
  const result = await requestJson<unknown>(`/api/alunos?q=${encodeURIComponent(query.trim())}`);
  const parsed = listAlunosResultDTOSchema.safeParse(result);

  if (!parsed.success) {
    return [];
  }

  return parsed.data.items
    .filter((item) => item.status === 'ATIVO')
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      nome: item.nome,
      email: item.email ?? null,
      telefone: item.telefone ?? null,
    }));
}