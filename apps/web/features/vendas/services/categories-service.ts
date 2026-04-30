export interface CategoryDTO {
  id: string;
  contaId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function parseCategory(raw: Record<string, unknown>): CategoryDTO {
  return {
    id: String(raw.id ?? ''),
    contaId: String(raw.contaId ?? ''),
    name: String(raw.name ?? ''),
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

export async function listCategories(): Promise<CategoryDTO[]> {
  const res = await fetch('/api/vendas/categorias', { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao listar categorias');
  return ((json as { data?: unknown[] })?.data ?? []).map((c) => parseCategory(c as Record<string, unknown>));
}

export async function createCategory(name: string): Promise<CategoryDTO> {
  const res = await fetch('/api/vendas/categorias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao criar categoria');
  return parseCategory((json as { data: Record<string, unknown> }).data);
}

export async function deleteCategory(id: string): Promise<void> {
  const res = await fetch(`/api/vendas/categorias/${id}`, { method: 'DELETE' });
  if (res.status === 204) return;
  const json = await res.json().catch(() => null);
  throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao deletar categoria');
}
