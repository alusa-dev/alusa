import { ProfileUpdateError } from './profile-service';

export async function uploadAvatarFile(blob: Blob, filename: string) {
  const form = new FormData();
  form.append('file', new File([blob], filename, { type: blob.type || 'image/jpeg' }));

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: form,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof json?.error === 'string' ? json.error : 'Falha no upload do avatar';
    throw new Error(message);
  }

  if (!json?.url || typeof json.url !== 'string') {
    throw new Error('Resposta inesperada do servidor de upload');
  }

  return json.url as string;
}

export async function updateAvatar(url: string | null) {
  const res = await fetch('/api/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foto: url }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const message = typeof json?.error === 'string' ? json.error : 'Falha ao atualizar avatar';
    throw new ProfileUpdateError(message, {
      status: res.status,
      fieldErrors: (json?.error as { fieldErrors?: Record<string, string[]> } | null)?.fieldErrors,
      formErrors: (json?.error as { formErrors?: string[] } | null)?.formErrors,
    });
  }

  return json;
}

export async function deleteUploadedFile(url: string): Promise<void> {
  try {
    // Apenas arquivos do nosso diretório público
    if (!url.startsWith('/uploads/')) return;
    await fetch('/api/upload', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    // Não bloquear fluxo por erro de limpeza
  }
}
