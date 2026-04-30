export type ComboStatus = 'ATIVO' | 'INATIVO';
export type ComboPeriodicidade = 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'TRIMESTRAL' | 'ANUAL';

export interface ComboListItem {
  id: string;
  contaId: string;
  nome: string;
  descricao: string | null;
  valor: number;
  periodicidade: ComboPeriodicidade;
  status: ComboStatus;
  vagasLimite: number | null;
  turmas: { id: string; nome: string }[];
  createdAt?: string;
  updatedAt?: string;
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new Error('Valor numérico inválido recebido.');
}

const PERIODICIDADES: ComboPeriodicidade[] = ['SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL'];

export function normalizeCombo(raw: unknown): ComboListItem {
  if (!raw || typeof raw !== 'object') throw new Error('Combo inválido.');
  const r = raw as Record<string, unknown>;
  const rawPeriodicidade = String(r.periodicidade ?? 'MENSAL').toUpperCase() as ComboPeriodicidade;
  return {
    id: String(r.id),
    contaId: String(r.contaId),
    nome: String(r.nome),
    descricao: r.descricao == null ? null : String(r.descricao),
    valor: coerceNumber(r.valor),
    periodicidade: PERIODICIDADES.includes(rawPeriodicidade) ? rawPeriodicidade : 'MENSAL',
    status: r.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    vagasLimite: r.vagasLimite == null ? null : Number(r.vagasLimite),
    turmas: Array.isArray(r.turmas)
      ? (r.turmas as unknown[]).map((t) => {
          const tt = t as Record<string, unknown>;
          return { id: String(tt.id), nome: String(tt.nome) };
        })
      : [],
    createdAt: r.createdAt ? String(r.createdAt) : undefined,
    updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
  };
}

export async function listCombos(params: {
  contaId: string;
  status?: ComboStatus;
  search?: string;
}) {
  const usp = new URLSearchParams({ contaId: params.contaId });
  if (params.status) usp.set('status', params.status);
  if (params.search) usp.set('q', params.search);
  const res = await fetch(`/api/combos?${usp.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Falha ao carregar combos.',
    );
  }
  const data = (json as { data?: unknown[] } | null)?.data || [];
  return data.map((d) => normalizeCombo(d));
}

export interface CreateComboInput {
  contaId: string;
  nome: string;
  descricao?: string | null;
  valor: number;
  periodicidade: ComboPeriodicidade;
  vagasLimite?: number | null;
  turmaIds?: string[];
}

export async function createComboRequest(input: CreateComboInput): Promise<ComboListItem> {
  const res = await fetch('/api/combos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message || 'Falha ao criar combo.',
    );
  }
  return normalizeCombo((json as { data?: unknown } | null)?.data);
}

export interface UpdateComboInput extends Partial<CreateComboInput> {
  id: string;
}

export async function updateComboRequest(input: UpdateComboInput): Promise<ComboListItem> {
  const { id, ...rest } = input;
  const res = await fetch(`/api/combos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(rest),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Falha ao atualizar combo.',
    );
  }
  return normalizeCombo((json as { data?: unknown } | null)?.data);
}

export async function deleteComboRequest(input: { id: string; contaId: string }) {
  const res = await fetch(`/api/combos/${input.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ contaId: input.contaId }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ||
        'Falha ao excluir combo.',
    );
  }
}
