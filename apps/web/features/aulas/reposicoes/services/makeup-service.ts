import type {
  CreateMakeupClassInputDTO,
  ListMakeupClassesQueryDTO,
  UpdateMakeupClassInputDTO,
} from '@/features/aulas/dtos';
import {
  mapListMakeupClassesResult,
  mapMakeupClassDetailsResult,
} from '@/features/aulas/mappers';
import { buildQueryString, requestJson } from '@/features/aulas/calendar/services/aulas-api';

export async function listMakeupClasses(query: Partial<ListMakeupClassesQueryDTO>) {
  const search = buildQueryString(query as Record<string, unknown>);
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/reposicoes?${search}`);
  return mapListMakeupClassesResult(result);
}

export async function getMakeupClass(id: string) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/reposicoes/${id}`);
  return mapMakeupClassDetailsResult(result);
}

export async function createMakeupClass(input: CreateMakeupClassInputDTO) {
  const result = await requestJson<Record<string, unknown>>('/api/aulas/reposicoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return mapMakeupClassDetailsResult(result);
}

export async function updateMakeupClass(id: string, input: UpdateMakeupClassInputDTO) {
  const result = await requestJson<Record<string, unknown>>(`/api/aulas/reposicoes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return mapMakeupClassDetailsResult(result);
}
