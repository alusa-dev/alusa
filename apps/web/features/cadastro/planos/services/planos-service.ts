export type PlanoStatus = 'ATIVO' | 'INATIVO';
export type PlanoPeriodicidade = 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'TRIMESTRAL' | 'ANUAL';

export interface PlanoListItem {
  id: string;
  contaId: string;
  nome: string;
  descricao: string | null;
  periodicidade: PlanoPeriodicidade;
  valor: number;
  status: PlanoStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListPlanosParams {
  contaId: string;
  status?: PlanoStatus;
  search?: string;
  signal?: AbortSignal;
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('Plano inválido: valor numérico ausente.');
}

export function normalizePlano(input: Partial<PlanoListItem> & { id?: unknown }): PlanoListItem {
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  if (!rawId) {
    throw new Error('Plano inválido recebido: id ausente na resposta.');
  }
  const contaId = typeof input.contaId === 'string' ? input.contaId : '';
  if (!contaId) {
    throw new Error('Plano inválido recebido: contaId ausente.');
  }
  const nome = typeof input.nome === 'string' ? input.nome : '';
  const descricao =
    input.descricao === null || input.descricao === undefined ? null : String(input.descricao);
  const allowed: PlanoPeriodicidade[] = ['SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL'];
  const periodicidade: PlanoPeriodicidade = allowed.includes(
    input.periodicidade as PlanoPeriodicidade,
  )
    ? (input.periodicidade as PlanoPeriodicidade)
    : 'MENSAL';
  const valor = coerceNumber(input.valor);
  const status: PlanoStatus = input.status === 'INATIVO' ? 'INATIVO' : 'ATIVO';

  return {
    id: rawId,
    contaId,
    nome,
    descricao,
    periodicidade,
    valor,
    status,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : undefined,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
  };
}

export function formatPlanoValorBRL(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

export async function listPlanos({ contaId, status, search, signal }: ListPlanosParams) {
  const params = new URLSearchParams({ contaId });
  if (status) params.set('status', status);
  if (search && search.trim()) params.set('q', search.trim());

  const response = await fetch(`/api/planos?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível carregar os planos.';
    throw new Error(message);
  }

  const data = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data?: unknown[] }).data as unknown[])
    : [];

  return data.map((item) => normalizePlano(item as Record<string, unknown>));
}

export interface CreatePlanoRequestInput {
  contaId: string;
  nome: string;
  descricao?: string | null;
  periodicidade: PlanoPeriodicidade;
  valor: number;
}

export async function createPlanoRequest(input: CreatePlanoRequestInput): Promise<PlanoListItem> {
  const response = await fetch('/api/planos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      contaId: input.contaId,
      nome: input.nome,
      descricao: input.descricao,
      periodicidade: input.periodicidade,
      valor: input.valor,
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível criar o plano.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao criar plano.');
  return normalizePlano(data);
}

export interface UpdatePlanoRequestInput {
  id: string;
  contaId: string;
  nome?: string;
  descricao?: string | null;
  periodicidade?: PlanoPeriodicidade;
  valor?: number;
  status?: PlanoStatus;
}

export async function updatePlanoRequest(input: UpdatePlanoRequestInput): Promise<PlanoListItem> {
  const response = await fetch('/api/planos', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível atualizar o plano.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao atualizar plano.');
  return normalizePlano(data);
}

export interface DeletePlanoRequestInput {
  id: string;
  contaId: string;
}

export async function deletePlanoRequest(input: DeletePlanoRequestInput): Promise<void> {
  const response = await fetch('/api/planos', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível excluir o plano.';
    throw new Error(message);
  }
}
