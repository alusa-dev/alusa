import { NextRequest } from 'next/server';
import { randomUUID, createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getSessionUser } from '@/lib/auth/session';
import { uploadContratoArquivoResultDTOSchema } from '@/features/contratos/dtos';
import { jsonNoStore } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { validateUploadBuffer } from '@/lib/upload-security';
import { isR2Configured, putStorageObject, storageUrlForKey } from '@/lib/r2-storage';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'contratos');
const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = ['application/pdf'];
const ALLOWED_EXTENSIONS = ['.pdf'];

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {
    // Diretório já existe
  }
}

function generateSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function validateFile(file: File): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Apenas arquivos PDF são permitidos.' };
  }

  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'Arquivo muito grande. Máximo 25MB.' };
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: 'Extensão de arquivo não permitida. Use PDF.' };
  }

  return { valid: true };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return jsonNoStore(
        { error: { message: 'Não autorizado' } },
        { status: 401 }
      );
    }

    const ip = ipFromRequest(req);
    const limiter = rateLimit(`contract-upload:${user.id}:${ip}`, 20, 10 * 60 * 1000);
    if (!limiter.ok) {
      return jsonNoStore(
        { error: { message: 'Muitas tentativas. Aguarde alguns minutos.' } },
        { status: 429 },
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return jsonNoStore(
        { error: { message: 'Nenhum arquivo enviado.' } },
        { status: 400 }
      );
    }

    const validation = validateFile(file);
    if (!validation.valid) {
      return jsonNoStore(
        { error: { message: validation.error } },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const binaryValidation = validateUploadBuffer({
      buffer: bytes,
      fileName: file.name,
      declaredMimeType: file.type,
      fileSize: file.size,
      maxSizeBytes: MAX_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
      allowedExtensions: ALLOWED_EXTENSIONS,
    });

    if (!binaryValidation.ok) {
      return jsonNoStore(
        { error: { message: binaryValidation.error } },
        { status: 400 },
      );
    }

    const hashSha256 = generateSha256(buffer);

    const filename = `${user.contaId}-${user.id}-${randomUUID()}${binaryValidation.extension}`;
    let url: string;
    if (isR2Configured()) {
      const key = `uploads/contratos/${filename}`;
      await putStorageObject({
        key,
        body: bytes,
        contentType: binaryValidation.detectedMimeType,
        contentLength: file.size,
      });
      url = storageUrlForKey(key);
    } else {
      await ensureDir();
      const filePath = path.join(UPLOAD_DIR, filename);
      await fs.writeFile(filePath, bytes);
      url = `/uploads/contratos/${filename}`;
    }

    const result = {
      url,
      hashSha256,
      size: file.size,
      mimeType: binaryValidation.detectedMimeType,
    };

    console.log('[CONTRATO_UPLOAD] Arquivo salvo:', {
      contaId: user.contaId,
      filename,
      hashSha256,
      size: file.size,
    });

    return jsonNoStore(uploadContratoArquivoResultDTOSchema.parse(result));
  } catch (error) {
    console.error('[CONTRATO_UPLOAD] Erro:', error);
    return jsonNoStore(
      { error: { message: 'Erro interno do servidor.' } },
      { status: 500 }
    );
  }
}
