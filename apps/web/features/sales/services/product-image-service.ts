function normalizeImageUrl(url: string): string {
  // Compatibilidade: registros antigos gravavam /public/uploads/...
  // Next.js serve public/ em /, então /public/uploads/ -> /uploads/
  return url.replace(/^\/public\//, '/');
}

export interface ProductImageDTO {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
}

export async function listProductImages(productId: string): Promise<ProductImageDTO[]> {
  const res = await fetch(`/api/vendas/produtos/${productId}/imagens`, {
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao listar imagens',
    );
  }
  const raw = ((json as { data?: unknown[] })?.data ?? []) as ProductImageDTO[];
  return raw.map((img) => ({ ...img, url: normalizeImageUrl(img.url) }));
}

export async function uploadProductImage(productId: string, file: File): Promise<ProductImageDTO> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`/api/vendas/produtos/${productId}/imagens`, {
    method: 'POST',
    body: formData,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao fazer upload',
    );
  }
  const img = (json as { data: ProductImageDTO }).data;
  return { ...img, url: normalizeImageUrl(img.url) };
}

export async function deleteProductImage(productId: string, imageId: string): Promise<void> {
  const res = await fetch(`/api/vendas/produtos/${productId}/imagens/${imageId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao deletar imagem',
    );
  }
}

export async function setPrimaryProductImage(productId: string, imageId: string): Promise<ProductImageDTO> {
  const res = await fetch(`/api/vendas/produtos/${productId}/imagens/${imageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao marcar primária',
    );
  }
  const img = (json as { data: ProductImageDTO }).data;
  return { ...img, url: normalizeImageUrl(img.url) };
}

export async function reorderProductImages(productId: string, orderedIds: string[]): Promise<void> {
  const res = await fetch(`/api/vendas/produtos/${productId}/imagens`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(
      (json as { error?: { message?: string } } | null)?.error?.message ?? 'Erro ao reordenar',
    );
  }
}
