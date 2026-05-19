import { listAlunosResultDTOSchema, type AlunoListItemDTO } from '../dtos';

export type AlunoListItem = AlunoListItemDTO;

export type ListAlunosParams = {
  contaId: string;
  signal?: AbortSignal;
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortOrder?: 'ASC' | 'DESC';
};

export type ListAlunosResult = {
  items: AlunoListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listAlunos({
  contaId,
  signal,
  q,
  status,
  page = 1,
  pageSize = 6,
  sortOrder = 'ASC',
}: ListAlunosParams): Promise<ListAlunosResult> {
  const params = new URLSearchParams({ contaId, page: String(page), pageSize: String(pageSize), sortOrder });
  if (q?.trim()) params.set('q', q.trim());
  if (status?.trim() && status !== 'TODOS') params.set('status', status.trim());

  const res = await fetch(`/api/alunos?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error?.message ?? 'Falha ao carregar alunos');
  }
  const json = await res.json();
  const parsed = listAlunosResultDTOSchema.safeParse(json);
  if (!parsed.success) {
    return { items: [], total: 0, page, pageSize };
  }
  return {
    items: parsed.data.items,
    total: parsed.data.total ?? parsed.data.items.length,
    page: parsed.data.page ?? page,
    pageSize: parsed.data.pageSize ?? pageSize,
  };
}

export async function deleteAluno({ id, reason }: { id: string; reason?: string }) {
  const search = reason?.trim() ? `?motivo=${encodeURIComponent(reason.trim())}` : '';
  const res = await fetch(`/api/alunos/${id}${search}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const message =
      typeof error?.error === 'string'
        ? error.error
        : error?.error?.message ?? error?.message ?? 'Erro ao excluir aluno';
    throw new Error(message);
  }
}
