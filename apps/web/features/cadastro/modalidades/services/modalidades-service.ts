export type ModalidadeStatus = 'ATIVO' | 'INATIVO';

export interface ModalidadeListItem {
  id: string;
  nome: string;
  descricao: string | null;
  status: ModalidadeStatus;
}

export interface ListModalidadesParams {
  contaId: string;
  search?: string;
  status?: ModalidadeStatus | 'TODOS';
  signal?: AbortSignal;
}

function normalizeModalidade(input: Partial<ModalidadeListItem> & { id?: unknown }) {
  return {
    id: String(input.id ?? ''),
    nome: String(input.nome ?? ''),
    descricao:
      input.descricao === null || input.descricao === undefined ? null : String(input.descricao),
    status: input.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
  } satisfies ModalidadeListItem;
}

export async function listModalidades({
  contaId,
  search,
  status,
  signal,
}: ListModalidadesParams): Promise<ModalidadeListItem[]> {
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

  return data.map((item) => normalizeModalidade(item as Record<string, unknown>));
}

export interface UpdateModalidadePayload {
  contaId: string;
  nome?: string;
  descricao?: string | null;
  status?: ModalidadeStatus;
}

export interface CreateModalidadePayload {
  contaId: string;
  nome: string;
  descricao?: string | null;
  status?: ModalidadeStatus; // default ATIVO se omitido
}

export async function createModalidade(
  payload: CreateModalidadePayload,
): Promise<ModalidadeListItem> {
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
  return normalizeModalidade(data);
}

export async function updateModalidade({
  id,
  payload,
}: {
  id: string;
  payload: UpdateModalidadePayload;
}): Promise<ModalidadeListItem> {
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

  return normalizeModalidade(data);
}

export async function deleteModalidade({
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
