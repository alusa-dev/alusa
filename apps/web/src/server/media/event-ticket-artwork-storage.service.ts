import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { deleteStorageObject, isR2Configured, putStorageObject, storageKeyFromUrl, storageUrlForKey } from '@/lib/r2-storage';

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const OUTPUT_SIZE = 1200;

export function validateTicketArtworkFile(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Use uma imagem JPG, PNG ou WebP.';
  if (file.size <= 0 || file.size > MAX_INPUT_BYTES) return 'A imagem deve ter no máximo 3 MB.';
  return null;
}

export async function normalizeEventTicketArtwork(bytes: Uint8Array): Promise<Buffer> {
  const input = Buffer.from(bytes);
  const metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
    throw new Error('Imagem inválida ou excessivamente grande.');
  }

  return sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' })
    .rotate()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

export async function persistEventTicketArtwork(params: { contaId: string; eventId: string; bytes: Uint8Array; objectKey?: string }) {
  const output = await normalizeEventTicketArtwork(params.bytes);
  const key = params.objectKey ?? `uploads/event-ticket-artwork/${params.contaId}/${params.eventId}/${randomUUID()}.jpg`;
  if (isR2Configured()) {
    await putStorageObject({ key, body: output, contentType: 'image/jpeg', contentLength: output.byteLength });
    return { url: storageUrlForKey(key), storageKey: key };
  }
  const relative = key.replace(/^uploads\//, 'uploads/');
  const absolute = path.join(process.cwd(), 'public', relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, output);
  return { url: `/${relative}`, storageKey: key };
}

export async function removeEventTicketArtwork(asset: { url: string; storageKey?: string | null } | null | undefined) {
  if (!asset) return;
  const key = asset.storageKey ?? storageKeyFromUrl(asset.url);
  if (key && isR2Configured()) { await deleteStorageObject(key).catch(() => null); return; }
  if (asset.url.startsWith('/uploads/')) await fs.unlink(path.join(process.cwd(), 'public', asset.url.replace(/^\//, ''))).catch(() => null);
}
