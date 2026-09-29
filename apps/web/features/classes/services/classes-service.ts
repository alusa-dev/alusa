export type ClassStatus = 'ATIVO' | 'INATIVO';

export interface ClassInstructorInfo {
  id: string;
  nome: string;
}

export interface ClassListItem {
  id: string;
  contaId: string;
  nome: string;
  status: ClassStatus;
  capacidade: number;
  vagasOcupadas: number;
  matriculasVinculadas: number;
  horaInicio: string;
  horaFim: string;
  diasSemana: string[];
  modalidadeId: string;
  salaId: string;
  professores: ClassInstructorInfo[];
  professoresCount: number;
  descricao: string | null;
}

export interface ListClassesParams {
  contaId: string;
  search?: string;
  status?: ClassStatus | 'TODOS';
  signal?: AbortSignal;
}

function normalizeClass(input: Partial<ClassListItem> & { id?: unknown }) {
  const diasSemana = Array.isArray(input.diasSemana) ? input.diasSemana : [];
  const professores = Array.isArray(input.professores)
    ? (input.professores as ClassInstructorInfo[]).map((prof) => ({
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
    matriculasVinculadas: Number.isFinite(input.matriculasVinculadas)
      ? Number(input.matriculasVinculadas)
      : 0,
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
  } satisfies ClassListItem;
}

export async function listClasses({
  contaId,
  search,
  status,
  signal,
}: ListClassesParams): Promise<ClassListItem[]> {
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

  return data.map((item) => normalizeClass(item as Record<string, unknown>));
}

export interface UpdateClassPayload {
  contaId: string;
  nome: string;
  status: ClassStatus;
  capacidade: number;
  horaInicio: string;
  horaFim: string;
  modalidadeId: string;
  salaId: string;
  diasSemana: string[];
}

export async function updateClass({
  id,
  payload,
}: {
  id: string;
  payload: UpdateClassPayload;
}): Promise<ClassListItem> {
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

  return normalizeClass(data);
}

export async function deleteClass({ id, contaId }: { id: string; contaId: string }): Promise<void> {
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
