import path from 'path';
import { imageSize } from 'image-size';

export const MAX_UPLOAD_IMAGE_PIXELS = 40_000_000;
export const MAX_UPLOAD_IMAGE_SIDE = 16_384;

type UploadValidationInput = {
  buffer: Uint8Array;
  fileName: string;
  declaredMimeType: string;
  fileSize: number;
  maxSizeBytes: number;
  allowedMimeTypes: readonly string[];
  allowedExtensions: readonly string[];
};

type UploadValidationResult =
  | { ok: true; extension: string; detectedMimeType: string }
  | { ok: false; error: string };

function hasPrefix(buffer: Uint8Array, prefix: readonly number[]) {
  return prefix.every((value, index) => buffer[index] === value);
}

export function detectMimeTypeFromBuffer(buffer: Uint8Array): string | null {
  if (buffer.length >= 5 && hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }

  if (buffer.length >= 3 && hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (buffer.length >= 6 && String.fromCharCode(...buffer.subarray(0, 6)).match(/^GIF8[79]a$/)) {
    return 'image/gif';
  }

  if (
    buffer.length >= 8 &&
    hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'image/png';
  }

  if (
    buffer.length >= 12 &&
    hasPrefix(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

export function validateImageDimensions(buffer: Uint8Array):
  | { ok: true; width: number; height: number }
  | { ok: false; error: string } {
  try {
    const dimensions = imageSize(buffer);
    const width = dimensions.width;
    const height = dimensions.height;
    if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
      return { ok: false, error: 'Dimensões da imagem inválidas.' };
    }
    if (width > MAX_UPLOAD_IMAGE_SIDE || height > MAX_UPLOAD_IMAGE_SIDE || width * height > MAX_UPLOAD_IMAGE_PIXELS) {
      return { ok: false, error: 'Imagem excede o limite de dimensões permitido (máximo 40 megapixels e 16.384 px por lado).' };
    }
    return { ok: true, width, height };
  } catch {
    return { ok: false, error: 'Não foi possível validar as dimensões da imagem.' };
  }
}

export function validateUploadBuffer(input: UploadValidationInput): UploadValidationResult {
  const extension = path.extname(input.fileName).toLowerCase();

  if (!input.allowedExtensions.includes(extension)) {
    return { ok: false, error: 'Extensão de arquivo não permitida.' };
  }

  if (input.fileSize > input.maxSizeBytes) {
    return { ok: false, error: 'Arquivo excede o tamanho máximo permitido.' };
  }

  const detectedMimeType = detectMimeTypeFromBuffer(input.buffer);
  if (!detectedMimeType || !input.allowedMimeTypes.includes(detectedMimeType)) {
    return { ok: false, error: 'Conteúdo do arquivo não permitido.' };
  }

  if (detectedMimeType.startsWith('image/')) {
    const dimensions = validateImageDimensions(input.buffer);
    if (!dimensions.ok) return dimensions;
  }

  const declaredMimeType = input.declaredMimeType.toLowerCase();
  if (declaredMimeType && !input.allowedMimeTypes.includes(declaredMimeType)) {
    return { ok: false, error: 'Tipo de arquivo não permitido.' };
  }

  const normalizedDeclaredMimeType =
    declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;
  if (normalizedDeclaredMimeType && normalizedDeclaredMimeType !== detectedMimeType) {
    return { ok: false, error: 'Tipo declarado do arquivo não confere com o conteúdo.' };
  }

  return {
    ok: true,
    extension,
    detectedMimeType,
  };
}
