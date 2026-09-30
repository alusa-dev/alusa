import { randomUUID } from 'node:crypto';
import { detectMimeTypeFromBuffer, validateImageDimensions } from '@/lib/upload-security';
import { withTenantUploadQuota } from '@/lib/upload-quota.server';
import {
  deleteStorageObject,
  isR2Configured,
  putStorageObject,
  storageKeyFromUrl,
  storageUrlForKey,
} from '@/lib/r2-storage';
import type { AvatarEntity } from '@/lib/media/avatar-url';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const ENTITY_FOLDER: Record<AvatarEntity, string> = {
  aluno: 'alunos',
  responsavel: 'responsaveis',
  colaborador: 'colaboradores',
  user: 'users',
};

function parseDataImageUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) return null;

  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) return null;

  const encoded = match[2];
  if (encoded.length > Math.ceil(MAX_AVATAR_BYTES * 4 / 3) + 4 || encoded.length % 4 !== 0) return null;
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_AVATAR_BYTES || buffer.toString('base64') !== encoded) return null;
  if (detectMimeTypeFromBuffer(buffer) !== mime) return null;
  if (!validateImageDimensions(buffer).ok) return null;

  return { mime, buffer };
}

function avatarStorageKey(params: {
  entity: AvatarEntity;
  contaId: string;
  entityId: string;
  extension: string;
}): string {
  return `uploads/${ENTITY_FOLDER[params.entity]}/${params.contaId}/${params.entityId}/avatar-${randomUUID()}${params.extension}`;
}

async function deletePreviousAvatar(previousFoto?: string | null) {
  if (!previousFoto || !isR2Configured()) return;

  const key = storageKeyFromUrl(previousFoto);
  if (!key) return;

  try {
    await deleteStorageObject(key);
  } catch (error) {
    console.warn('[avatar-storage] Falha ao remover avatar anterior', error);
  }
}

export async function discardAvatarUpload(foto?: string | null) {
  if (!foto || !isR2Configured()) return;
  const key = storageKeyFromUrl(foto);
  if (!key) return;
  await deleteStorageObject(key);
}

export async function persistAvatarFromDataUrl(params: {
  entity: AvatarEntity;
  entityId: string;
  contaId: string;
  dataUrl: string;
  previousFoto?: string | null;
}): Promise<string> {
  const parsed = parseDataImageUrl(params.dataUrl);
  if (!parsed) {
    throw new Error('Formato, conteúdo ou dimensões da imagem inválidos ou excedem o limite permitido.');
  }

  const extension = EXT_BY_MIME[parsed.mime] ?? '.jpg';
  const key = avatarStorageKey({
    entity: params.entity,
    contaId: params.contaId,
    entityId: params.entityId,
    extension,
  });

  const stored = await withTenantUploadQuota({
    contaId: params.contaId,
    fileSize: parsed.buffer.length,
    contentType: parsed.mime,
    objectKey: key,
    cleanup: async () => { if (isR2Configured()) await deleteStorageObject(key).catch(() => undefined); },
    action: async () => {
      if (!isR2Configured()) return params.dataUrl;
      await putStorageObject({ key, body: parsed.buffer, contentType: parsed.mime, contentLength: parsed.buffer.length });
      return storageUrlForKey(key);
    },
  });
  if (!stored.ok) throw new Error('Limite diário de uploads da conta excedido.');
  if (isR2Configured()) await deletePreviousAvatar(params.previousFoto);
  return stored.result;
}

export async function normalizeAvatarUpload(params: {
  entity: AvatarEntity;
  entityId: string;
  contaId: string;
  foto?: string | null;
  previousFoto?: string | null;
}): Promise<string | null | undefined> {
  const { foto } = params;
  if (foto === undefined) return undefined;
  if (foto === null || foto.trim() === '') return null;
  if (foto.startsWith('data:image/')) {
    return persistAvatarFromDataUrl({
      entity: params.entity,
      entityId: params.entityId,
      contaId: params.contaId,
      dataUrl: foto,
      previousFoto: params.previousFoto,
    });
  }
  return foto;
}
