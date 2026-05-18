import { createHash } from 'crypto';

export type AvatarEntity = 'aluno' | 'responsavel' | 'colaborador' | 'user';

const DATA_IMAGE_PREFIX = 'data:image/';

export function isDataImageUrl(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(DATA_IMAGE_PREFIX));
}

export function isExternalImageUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

export function isInternalStorageUrl(value: string): boolean {
  return value.startsWith('/api/files/') || value.startsWith('/api/media/avatar/');
}

export function avatarVersionFromFoto(
  foto: string | null | undefined,
  updatedAt?: Date | string | null,
): string {
  if (!foto) return '0';

  const timestamp =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : updatedAt
        ? new Date(updatedAt).getTime()
        : 0;

  const seed = `${foto.length}:${foto.slice(0, 48)}:${timestamp}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 8);
}

export function resolvePublicAvatarUrl(params: {
  entity: AvatarEntity;
  id: string;
  foto?: string | null;
  version?: string | null;
}): string | null {
  const foto = params.foto?.trim();
  if (!foto) return null;

  if (isExternalImageUrl(foto) || isInternalStorageUrl(foto)) {
    return foto;
  }

  if (isDataImageUrl(foto)) {
    const version = params.version ?? avatarVersionFromFoto(foto);
    return `/api/media/avatar/${params.entity}/${params.id}?v=${version}`;
  }

  return foto.startsWith('/') ? foto : null;
}

export function resolveAlunoPublicAvatar(aluno: {
  id: string;
  foto?: string | null;
  updatedAt?: Date | string | null;
}): string | null {
  return resolvePublicAvatarUrl({
    entity: 'aluno',
    id: aluno.id,
    foto: aluno.foto,
    version: avatarVersionFromFoto(aluno.foto, aluno.updatedAt),
  });
}

/** @deprecated Prefer resolvePublicAvatarUrl or resolveAlunoPublicAvatar with entity id. */
export function publicImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isDataImageUrl(value)) return null;
  return value;
}

export function withResolvedAvatarFields<T extends { id: string; foto?: string | null; updatedAt?: Date | string | null }>(
  entity: AvatarEntity,
  record: T,
): T & { avatarUrl: string | null; foto: string | null } {
  const avatarUrl = resolvePublicAvatarUrl({
    entity,
    id: record.id,
    foto: record.foto,
    version: avatarVersionFromFoto(record.foto, record.updatedAt),
  });

  return {
    ...record,
    avatarUrl,
    foto: avatarUrl,
  };
}
