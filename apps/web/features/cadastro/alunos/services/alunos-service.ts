import { listAlunosResultDTOSchema, type AlunoListItemDTO } from '../dtos';

export type AlunoListItem = AlunoListItemDTO;

function extractList(data: unknown): AlunoListItem[] {
  const parsed = listAlunosResultDTOSchema.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.items;
}

export async function listAlunos({
  contaId,
  signal,
}: {
  contaId: string;
  signal?: AbortSignal;
}): Promise<AlunoListItem[]> {
  const params = new URLSearchParams({ contaId });
  const res = await fetch(`/api/alunos?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error?.message ?? 'Falha ao carregar alunos');
  }
  const json = await res.json();
  return extractList(json);
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
