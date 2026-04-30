export type TurmaStatus = 'ATIVO' | 'INATIVO';

export interface TurmaProfessorInfo {
  id: string;
  nome: string;
}

export interface TurmaListItem {
  id: string;
  contaId: string;
  nome: string;
  status: TurmaStatus;
  capacidade: number;
  vagasOcupadas: number;
  horaInicio: string;
  horaFim: string;
  diasSemana: string[];
  modalidadeId: string;
  salaId: string;
  professores: TurmaProfessorInfo[];
  professoresCount: number;
  descricao: string | null;
}

export interface ListTurmasParams {
  contaId: string;
  search?: string;
  status?: TurmaStatus | 'TODOS';
  signal?: AbortSignal;
}

function normalizeTurma(input: Partial<TurmaListItem> & { id?: unknown }) {
  const diasSemana = Array.isArray(input.diasSemana) ? input.diasSemana : [];
  const professores = Array.isArray(input.professores)
    ? (input.professores as TurmaProfessorInfo[]).map((prof) => ({
        id: String(prof.id ?? ''),
        nome: String(prof.nome ?? ''),
      }))
    : [];
  const professoresCount = Number.isFinite(input.professoresCount)
    ? Number(input.professoresCount)
    : professores.length;

  return {
    id: String(input.id ?? ''),
    contaId: String(input.contaId ?? ''),
    nome: String(input.nome ?? ''),
    status: input.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
    capacidade: Number.isFinite(input.capacidade) ? Number(input.capacidade) : 0,
    vagasOcupadas: Number.isFinite(input.vagasOcupadas) ? Number(input.vagasOcupadas) : 0,
    horaInicio: String(input.horaInicio ?? ''),
    horaFim: String(input.horaFim ?? ''),
    diasSemana: diasSemana.map((dia) => String(dia)),
    modalidadeId: String(input.modalidadeId ?? ''),
    salaId: String(input.salaId ?? ''),
    professores,
    professoresCount,
    // Backend usa campo `observacao`; frontend vinha tratando `descricao`.
    // Aceitamos ambas por compatibilidade até refactor global.
    descricao: ((): string | null => {
      type WithDescricaoObservacao = { descricao?: unknown; observacao?: unknown };
      const candidate = input as unknown as WithDescricaoObservacao;
      const raw = candidate.descricao !== undefined ? candidate.descricao : candidate.observacao;
      if (raw === null || raw === undefined) return null;
      return String(raw);
    })(),
  } satisfies TurmaListItem;
}

export async function listTurmas({
  contaId,
  search,
  status,
  signal,
}: ListTurmasParams): Promise<TurmaListItem[]> {
  const params = new URLSearchParams();
  params.set('contaId', contaId);
  params.set('include', 'professores');
  if (search && search.trim()) params.set('q', search.trim());
  if (status && status !== 'TODOS') params.set('status', status);
  params.set('page', '1');
  params.set('pageSize', '200');

  const response = await fetch(`/api/turmas?${params.toString()}`, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json' },
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: string; detail?: string } | null)?.detail ??
      (json as { error?: { message?: string } } | null)?.error?.message ??
      'Não foi possível listar as turmas.';
    throw new Error(message);
  }

  const data = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data?: unknown[] }).data as unknown[])
    : [];

  return data.map((item) => normalizeTurma(item as Record<string, unknown>));
}

export interface UpdateTurmaPayload {
  contaId: string;
  nome: string;
  status: TurmaStatus;
  capacidade: number;
  horaInicio: string;
  horaFim: string;
  modalidadeId: string;
  salaId: string;
  diasSemana: string[];
}

export async function updateTurma({
  id,
  payload,
}: {
  id: string;
  payload: UpdateTurmaPayload;
}): Promise<TurmaListItem> {
  const response = await fetch(`/api/turmas/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (json as { error?: { message?: string; code?: string } } | null)?.error?.message ??
      (json as { detail?: string } | null)?.detail ??
      'Não foi possível atualizar a turma.';
    throw new Error(message);
  }

  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) throw new Error('Resposta inválida ao atualizar turma.');

  return normalizeTurma(data);
}

export async function deleteTurma({ id, contaId }: { id: string; contaId: string }): Promise<void> {
  const params = new URLSearchParams();
  params.set('contaId', contaId);

  const response = await fetch(`/api/turmas/${id}?${params.toString()}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      (json as { detail?: string } | null)?.detail ??
      'Não foi possível excluir a turma.';
    throw new Error(message);
  }
}
