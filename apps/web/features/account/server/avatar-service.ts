import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { imageSize } from 'image-size';

import prisma from '@/lib/prisma';
import {
  deleteStorageObject,
  isR2Configured,
  putStorageObject,
  storageKeyFromUrl,
  storageUrlForKey,
} from '@/lib/r2-storage';
import { validateUploadBuffer } from '@/lib/upload-security';

const AVATAR_SIDE_PX = 512;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

export class AvatarServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message);
    this.name = 'AvatarServiceError';
    this.status = status;
    this.code = code;
  }
}

type AvatarActor = {
  userId: string;
  contaId: string;
};

type PreparedAvatar = {
  bytes: Uint8Array;
  extension: string;
  mimeType: string;
};

function ownedAvatarFileName(url: string, userId: string): string | null {
  const storageKey = storageKeyFromUrl(url);
  const fileName = storageKey
    ? path.basename(storageKey)
    : /^\/uploads\/[^/]+$/.test(url)
      ? path.basename(url)
      : null;

  if (!fileName || !fileName.includes(`-${userId}-`)) return null;
  return fileName;
}

async function deleteOwnedAvatar(url: string | null, userId: string): Promise<void> {
  if (!url) return;
  const fileName = ownedAvatarFileName(url, userId);
  if (!fileName) return;

  const storageKey = storageKeyFromUrl(url);
  if (storageKey) {
    await deleteStorageObject(storageKey);
    return;
  }

  await fs.unlink(path.join(AVATAR_UPLOAD_DIR, fileName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function requireActiveMembership(actor: AvatarActor) {
  const membership = await prisma.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
    },
    select: {
      usuario: { select: { foto: true } },
    },
  });

  if (!membership) {
    throw new AvatarServiceError('Usuário sem acesso à conta ativa.', 403, 'MEMBERSHIP_REQUIRED');
  }

  return membership.usuario.foto;
}

async function storeAvatar(actor: AvatarActor, avatar: PreparedAvatar) {
  const fileName = `${actor.contaId}-${actor.userId}-${randomUUID()}${avatar.extension}`;

  if (isR2Configured()) {
    const key = `uploads/avatars/${fileName}`;
    await putStorageObject({
      key,
      body: avatar.bytes,
      contentType: avatar.mimeType,
      contentLength: avatar.bytes.byteLength,
    });
    return storageUrlForKey(key);
  }

  await fs.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(AVATAR_UPLOAD_DIR, fileName), avatar.bytes);
  return `/uploads/${fileName}`;
}

export async function prepareAvatarFile(file: File): Promise<PreparedAvatar> {
  if (file.size <= 0) {
    throw new AvatarServiceError('O arquivo de imagem está vazio.', 400, 'EMPTY_FILE');
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new AvatarServiceError('A foto processada deve ter no máximo 2 MB.', 400, 'FILE_TOO_LARGE');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUploadBuffer({
    buffer: bytes,
    fileName: file.name,
    declaredMimeType: file.type,
    fileSize: file.size,
    maxSizeBytes: AVATAR_MAX_BYTES,
    allowedMimeTypes: AVATAR_MIME_TYPES,
    allowedExtensions: AVATAR_EXTENSIONS,
  });

  if (!validation.ok) {
    throw new AvatarServiceError(validation.error, 400, 'INVALID_FILE');
  }

  let dimensions: { width?: number; height?: number };
  try {
    dimensions = imageSize(bytes);
  } catch {
    throw new AvatarServiceError('Não foi possível validar as dimensões da imagem.', 400, 'INVALID_DIMENSIONS');
  }

  if (dimensions.width !== AVATAR_SIDE_PX || dimensions.height !== AVATAR_SIDE_PX) {
    throw new AvatarServiceError(
      `A foto deve ter exatamente ${AVATAR_SIDE_PX}×${AVATAR_SIDE_PX}px.`,
      400,
      'INVALID_DIMENSIONS',
    );
  }

  return {
    bytes,
    extension: validation.extension === '.jpeg' ? '.jpg' : validation.extension,
    mimeType: validation.detectedMimeType,
  };
}

export async function replaceCurrentAvatar(
  actor: AvatarActor,
  avatar: PreparedAvatar,
  correlationId: string,
) {
  const previousUrl = await requireActiveMembership(actor);
  const nextUrl = await storeAvatar(actor, avatar);

  try {
    const update = await prisma.usuario.updateMany({
      where: { id: actor.userId, foto: previousUrl },
      data: { foto: nextUrl },
    });

    if (update.count !== 1) {
      throw new AvatarServiceError(
        'A foto foi alterada em outra sessão. Recarregue a página e tente novamente.',
        409,
        'CONCURRENT_UPDATE',
      );
    }
  } catch (error) {
    await deleteOwnedAvatar(nextUrl, actor.userId).catch((cleanupError) => {
      console.error('[avatar] Falha ao compensar arquivo novo.', { correlationId, cleanupError });
    });
    throw error;
  }

  await deleteOwnedAvatar(previousUrl, actor.userId).catch((cleanupError) => {
    console.error('[avatar] Falha ao remover arquivo anterior.', { correlationId, cleanupError });
  });

  return { url: nextUrl };
}

export async function removeCurrentAvatar(actor: AvatarActor, correlationId: string) {
  const previousUrl = await requireActiveMembership(actor);
  if (!previousUrl) return { url: null };

  const update = await prisma.usuario.updateMany({
    where: { id: actor.userId, foto: previousUrl },
    data: { foto: null },
  });

  if (update.count !== 1) {
    throw new AvatarServiceError(
      'A foto foi alterada em outra sessão. Recarregue a página e tente novamente.',
      409,
      'CONCURRENT_UPDATE',
    );
  }

  await deleteOwnedAvatar(previousUrl, actor.userId).catch((cleanupError) => {
    console.error('[avatar] Falha ao remover arquivo excluído.', { correlationId, cleanupError });
  });

  return { url: null };
}
