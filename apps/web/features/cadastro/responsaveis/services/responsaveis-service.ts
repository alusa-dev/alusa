import {
  createResponsavelResultDTOSchema,
  listResponsaveisResultDTOSchema,
  responsavelDetailDTOSchema,
  responsavelOverviewDTOSchema,
  type CreateResponsavelInputDTO,
  type ResponsavelDetailDTO,
  type ResponsavelOverviewDTO,
  type ResponsavelSummaryDTO,
  type UpdateResponsavelInputDTO,
} from '@/features/responsaveis/dtos';

export type ResponsavelListItem = ResponsavelSummaryDTO;
export type ResponsavelDetail = ResponsavelDetailDTO;
export type ResponsavelOverview = ResponsavelOverviewDTO;

function parseErrorPayload(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === 'string') return error.message;
  }
  if (typeof record.message === 'string') return record.message;
  return fallback;
}

export async function listResponsaveis({
  signal,
  query,
}: {
  signal?: AbortSignal;
  query?: string;
} = {}): Promise<ResponsavelListItem[]> {
  const searchParams = new URLSearchParams();
  if (query?.trim()) {
    searchParams.set('q', query.trim());
  }

  const res = await fetch(`/api/responsaveis${searchParams.size ? `?${searchParams.toString()}` : ''}`, {
    cache: 'no-store',
    signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(parseErrorPayload(error, 'Falha ao carregar responsáveis'));
  }

  const json = await res.json();
  const parsed = listResponsaveisResultDTOSchema.safeParse(json);
  return parsed.success ? parsed.data.items : [];
}

export async function getResponsavel({
  id,
  signal,
}: {
  id: string;
  signal?: AbortSignal;
}): Promise<ResponsavelDetail> {
  const res = await fetch(`/api/responsaveis/${id}`, {
    cache: 'no-store',
    signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(parseErrorPayload(error, 'Falha ao carregar responsável'));
  }

  const json = await res.json();
  return responsavelDetailDTOSchema.parse(json);
}

export async function createResponsavel(input: CreateResponsavelInputDTO) {
  const res = await fetch('/api/responsaveis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(parseErrorPayload(error, 'Erro ao criar responsável'));
  }

  const json = await res.json();
  return createResponsavelResultDTOSchema.parse(json);
}

export async function updateResponsavel(id: string, input: UpdateResponsavelInputDTO) {
  const res = await fetch(`/api/responsaveis/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(parseErrorPayload(error, 'Erro ao atualizar responsável'));
  }

  const json = await res.json();
  return responsavelDetailDTOSchema.parse(json);
}

export async function deleteResponsavel(id: string) {
  const res = await fetch(`/api/responsaveis/${id}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(parseErrorPayload(error, 'Erro ao excluir responsável'));
  }
}

export async function getResponsavelOverview({
  id,
  signal,
}: {
  id: string;
  signal?: AbortSignal;
}): Promise<ResponsavelOverview> {
  const res = await fetch(`/api/responsaveis/${id}/overview`, {
    cache: 'no-store',
    signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(parseErrorPayload(error, 'Falha ao carregar visão do responsável'));
  }

  const json = await res.json();
  return responsavelOverviewDTOSchema.parse(json);
}

export async function createRematriculaFamiliar(input: Record<string, unknown>) {
  const res = await fetch('/api/rematriculas/familiar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parseErrorPayload(json, 'Erro ao iniciar rematrícula familiar'));
  }

  return json;
}
