import { z } from 'zod';

import { ProfileUpdateError } from './profile-service';

const avatarResponseSchema = z.object({
  url: z.string().min(1).nullable(),
  correlationId: z.string().min(1),
});

async function parseAvatarResponse(response: Response) {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof json?.error === 'string'
      ? json.error
      : 'Não foi possível atualizar a foto.';
    throw new ProfileUpdateError(message, { status: response.status });
  }

  const parsed = avatarResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error('Resposta inesperada do servidor de avatar.');
  }
  return parsed.data;
}

export async function saveCurrentAvatar(blob: Blob) {
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const form = new FormData();
  form.append('file', new File([blob], `avatar.${extension}`, { type: blob.type || 'image/jpeg' }));

  const response = await fetch('/api/users/me/avatar', {
    method: 'POST',
    body: form,
  });
  return parseAvatarResponse(response);
}

export async function removeCurrentAvatar() {
  const response = await fetch('/api/users/me/avatar', { method: 'DELETE' });
  return parseAvatarResponse(response);
}
