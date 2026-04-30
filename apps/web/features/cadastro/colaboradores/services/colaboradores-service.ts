import { z } from 'zod';

const colaboradorListItemSchema = z.object({
  id: z.string(),
  nome: z.string().default(''),
  email: z.string().nullable().optional(),
  telefone1: z.string().nullable().optional(),
  status: z.string().default('ATIVO'),
  foto: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  cargo: z.string().default('OUTRO'),
  especialidade: z.string().nullable().optional(),
});

export type ColaboradorListItem = z.infer<typeof colaboradorListItemSchema>;

const colaboradorListResponseSchema = z.object({
  items: z.array(colaboradorListItemSchema).default([]),
});

export async function listColaboradores({
  contaId,
  signal,
}: {
  contaId: string;
  signal?: AbortSignal;
}): Promise<ColaboradorListItem[]> {
  const params = new URLSearchParams({ contaId });
  const res = await fetch(`/api/colaboradores?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error?.message ?? 'Falha ao carregar colaboradores');
  }
  const json = await res.json();
  const parsed = colaboradorListResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.items;
}

export async function deleteColaborador({ id, reason }: { id: string; reason?: string }) {
  const qs = reason?.trim() ? `?motivo=${encodeURIComponent(reason.trim())}` : '';
  const res = await fetch(`/api/colaboradores/${id}${qs}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error?.error?.message ?? 'Erro ao excluir colaborador');
  }
}
