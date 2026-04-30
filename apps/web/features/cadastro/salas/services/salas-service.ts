export type SalaStatus = 'ATIVO' | 'INATIVO';

export interface SalaListItem {
  id: string;
  nome: string;
  descricao: string | null;
  capacidade: number;
  status: SalaStatus;
}

export interface ListSalasParams {
  contaId: string;
  search?: string;
  status?: SalaStatus | 'TODOS';
  signal?: AbortSignal;
}

function normalizeSala(input: Partial<SalaListItem> & { id?: unknown; capacidade?: unknown }) {
  const rawCapacidade = input.capacidade;
  const capacidadeValue =
    typeof rawCapacidade === 'number'
      ? rawCapacidade
      : Number.parseInt(String(rawCapacidade ?? '').trim() || '0', 10);

  return {
    id: String(input.id ?? ''),
    nome: String(input.nome ?? ''),
    descricao:
      input.descricao === null || input.descricao === undefined ? null : String(input.descricao),
    capacidade: Number.isFinite(capacidadeValue) && capacidadeValue > 0 ? capacidadeValue : 0,
    status: input.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
  } satisfies SalaListItem;
}

export async function listSalas({ contaId, search, status, signal }: ListSalasParams) {
  const params = new URLSearchParams();
  params.set('contaId', contaId);
  if (search && search.trim()) params.set('q', search.trim());
  if (status && status !== 'TODOS') params.set('status', status);

  const response = await fetch(`/api/salas?${params.toString()}`, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível listar as salas.';
    throw new Error(message);
  }

  const payload = (json as { data?: unknown; items?: unknown }) ?? {};
  const data = Array.isArray(payload.data)
    ? (payload.data as unknown[])
    : Array.isArray(payload.items)
      ? (payload.items as unknown[])
      : [];

  return data.map((item) => normalizeSala(item as Record<string, unknown>));
}

export interface UpdateSalaPayload {
  contaId: string;
  nome?: string;
  descricao?: string | null;
  capacidade?: number;
  status?: SalaStatus;
}

export interface CreateSalaPayload {
  contaId: string;
  nome: string;
  descricao?: string | null;
  capacidade: number;
  status?: SalaStatus; // default ATIVO
}

export async function createSala(payload: CreateSalaPayload): Promise<SalaListItem> {
  const response = await fetch('/api/salas', {
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
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível criar a sala.';
    throw new Error(message);
  }
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao criar sala.');
  return normalizeSala(data);
}

export async function updateSala({
  id,
  payload,
}: {
  id: string;
  payload: UpdateSalaPayload;
}): Promise<SalaListItem> {
  const response = await fetch(`/api/salas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível atualizar a sala.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao atualizar sala.');

  return normalizeSala(data);
}

export async function deleteSala({ id, contaId }: { id: string; contaId: string }): Promise<void> {
  const params = new URLSearchParams();
  params.set('contaId', contaId);

  const response = await fetch(`/api/salas/${id}?${params.toString()}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível excluir a sala.';
    throw new Error(message);
  }
}
