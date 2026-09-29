export type BundleStatus = 'ATIVO' | 'INATIVO';
export type BundleBillingPeriod = 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'TRIMESTRAL' | 'ANUAL';

export interface BundleListItem {
  id: string;
  contaId: string;
  nome: string;
  descricao: string | null;
  valor: number;
  periodicidade: BundleBillingPeriod;
  status: BundleStatus;
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

const PERIODICIDADES: BundleBillingPeriod[] = ['SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'ANUAL'];

export function normalizeBundle(raw: unknown): BundleListItem {
  if (!raw || typeof raw !== 'object') throw new Error('Combo inválido.');
  const r = raw as Record<string, unknown>;
  const rawPeriodicidade = String(r.periodicidade ?? 'MENSAL').toUpperCase() as BundleBillingPeriod;
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

export async function listBundles(params: {
  contaId: string;
  status?: BundleStatus;
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
  return data.map((d) => normalizeBundle(d));
}

export interface CreateBundleInput {
  contaId: string;
  nome: string;
  descricao?: string | null;
  valor: number;
  periodicidade: BundleBillingPeriod;
  vagasLimite?: number | null;
  turmaIds?: string[];
}

export async function createBundleRequest(input: CreateBundleInput): Promise<BundleListItem> {
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
  return normalizeBundle((json as { data?: unknown } | null)?.data);
}

export interface UpdateBundleInput extends Partial<CreateBundleInput> {
  id: string;
}

export async function updateBundleRequest(input: UpdateBundleInput): Promise<BundleListItem> {
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
  return normalizeBundle((json as { data?: unknown } | null)?.data);
}

export async function deleteBundleRequest(input: { id: string; contaId: string }) {
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
