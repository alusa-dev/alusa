import path from 'path';

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
