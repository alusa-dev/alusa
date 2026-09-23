import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import {
  deleteStorageObject,
  isR2Configured,
  putStorageObject,
  storageKeyFromUrl,
  storageUrlForKey,
} from '@/lib/r2-storage';
import type { MapReferenceChart } from '@alusa/domain';

const ALLOWED_MIME_TYPES = new Set<MapReferenceChart['mimeType']>(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 15 * 1024 * 1024;
const EXTENSIONS: Record<MapReferenceChart['mimeType'], string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function validateReferenceFile(file: File) {
  if (!ALLOWED_MIME_TYPES.has(file.type as MapReferenceChart['mimeType'])) {
    return 'Use uma imagem JPG, PNG ou WebP.';
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return 'A planta deve ter no máximo 15 MB.';
  }
  return null;
}

export async function persistEventMapReferenceFile(params: {
  contaId: string;
  mapId: string;
  file: File;
  bytes: Uint8Array;
}): Promise<{ url: string; storageKey: string | null; width: number; height: number; mimeType: MapReferenceChart['mimeType'] }> {
  const mimeType = params.file.type as MapReferenceChart['mimeType'];
  const dimensions = imageSize(Buffer.from(params.bytes));
  if (!dimensions.width || !dimensions.height) throw new Error('Não foi possível ler as dimensões da planta.');

  const key = `uploads/event-maps/${params.contaId}/${params.mapId}/reference-${randomUUID()}${EXTENSIONS[mimeType]}`;
  if (isR2Configured()) {
    await putStorageObject({ key, body: params.bytes, contentType: mimeType, contentLength: params.file.size });
    return { url: storageUrlForKey(key), storageKey: key, width: dimensions.width, height: dimensions.height, mimeType };
  }

  const relativePath = key.replace(/^uploads\//, 'uploads/');
  const absolutePath = path.join(process.cwd(), 'public', relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, params.bytes);
  return { url: `/${relativePath}`, storageKey: key, width: dimensions.width, height: dimensions.height, mimeType };
}

export async function removeEventMapReferenceFile(reference: Pick<MapReferenceChart, 'url' | 'storageKey'> | null | undefined) {
  if (!reference) return;
  const storageKey = reference.storageKey ?? storageKeyFromUrl(reference.url);
  if (storageKey && isR2Configured()) {
    await deleteStorageObject(storageKey).catch(() => null);
    return;
  }
  if (reference.url.startsWith('/uploads/')) {
    await fs.unlink(path.join(process.cwd(), 'public', reference.url.replace(/^\//, ''))).catch(() => null);
  }
}
