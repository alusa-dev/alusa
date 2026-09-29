export type ModalityStatus = 'ATIVO' | 'INATIVO';

export interface ModalityListItem {
  id: string;
  nome: string;
  descricao: string | null;
  status: ModalityStatus;
}

export interface ListModalitiesParams {
  contaId: string;
  search?: string;
  status?: ModalityStatus | 'TODOS';
  signal?: AbortSignal;
}

function normalizeModality(input: Partial<ModalityListItem> & { id?: unknown }) {
  return {
    id: String(input.id ?? ''),
    nome: String(input.nome ?? ''),
    descricao:
      input.descricao === null || input.descricao === undefined ? null : String(input.descricao),
    status: input.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
  } satisfies ModalityListItem;
}

export async function listModalities({
  contaId,
  search,
  status,
  signal,
}: ListModalitiesParams): Promise<ModalityListItem[]> {
  const params = new URLSearchParams();
  params.set('contaId', contaId);
  if (search && search.trim()) params.set('q', search.trim());
  if (status && status !== 'TODOS') params.set('status', status);

  const response = await fetch(`/api/modalidades?${params.toString()}`, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível listar as modalidades.';
    throw new Error(message);
  }

  const data = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data?: unknown[] }).data as unknown[])
    : [];

  return data.map((item) => normalizeModality(item as Record<string, unknown>));
}

export interface UpdateModalityPayload {
  contaId: string;
  nome?: string;
  descricao?: string | null;
  status?: ModalityStatus;
}

export interface CreateModalityPayload {
  contaId: string;
  nome: string;
  descricao?: string | null;
  status?: ModalityStatus; // default ATIVO se omitido
}

export async function createModality(
  payload: CreateModalityPayload,
): Promise<ModalityListItem> {
  const response = await fetch('/api/modalidades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ...payload,
      status: payload.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    }),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ||
      'Não foi possível criar a modalidade.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao criar modalidade.');
  return normalizeModality(data);
}

export async function updateModality({
  id,
  payload,
}: {
  id: string;
  payload: UpdateModalityPayload;
}): Promise<ModalityListItem> {
  const response = await fetch(`/api/modalidades/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível atualizar a modalidade.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao atualizar modalidade.');

  return normalizeModality(data);
}

export async function deleteModality({
  id,
  contaId,
}: {
  id: string;
  contaId: string;
}): Promise<void> {
  const params = new URLSearchParams();
  params.set('contaId', contaId);

  const response = await fetch(`/api/modalidades/${id}?${params.toString()}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível excluir a modalidade.';
    throw new Error(message);
  }
}
