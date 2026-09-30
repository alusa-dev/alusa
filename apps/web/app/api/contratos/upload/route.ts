import { NextRequest } from 'next/server';
import { randomUUID, createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getSessionUser } from '@/lib/auth/session';
import { uploadContratoArquivoResultDTOSchema } from '@/features/contracts/dtos';
import { jsonNoStore } from '@/lib/http-security';
import { ipFromRequest, strictRateLimitAsync } from '@/lib/rate-limit';
import { readBoundedFormData } from '@/lib/upload-request';
import { withTenantUploadQuota } from '@/lib/upload-quota.server';
import { validateUploadBuffer } from '@/lib/upload-security';
import { deleteStorageObject, isR2Configured, putStorageObject, storageUrlForKey } from '@/lib/r2-storage';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'contratos');
const MAX_SIZE = 3 * 1024 * 1024; // limit Vercel com margem multipart
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
    return { valid: false, error: 'Arquivo muito grande. O envio inline aceita até 3 MiB; arquivos maiores usam upload direto ao armazenamento.' };
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
    const limiter = await strictRateLimitAsync(`contract-upload:${user.contaId}:${user.id}:${ip}`, 20, 10 * 60 * 1000);
    if (!limiter.ok) {
      return jsonNoStore(
        { error: { message: 'Muitas tentativas. Aguarde alguns minutos.' } },
        { status: 429 },
      );
    }

    const parsedBody = await readBoundedFormData(req);
    if (!parsedBody.ok) return jsonNoStore({ error: { message: parsedBody.error } }, { status: parsedBody.status });
    const formData = parsedBody.formData;
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
    const storageKey = `uploads/contratos/${filename}`;
    const stored = await withTenantUploadQuota({
      contaId: user.contaId,
      fileSize: file.size,
      contentType: binaryValidation.detectedMimeType,
      objectKey: storageKey,
      cleanup: async () => {
        if (isR2Configured()) await deleteStorageObject(storageKey).catch(() => undefined);
        else await fs.unlink(path.join(UPLOAD_DIR, filename)).catch(() => undefined);
      },
      action: async () => {
        if (isR2Configured()) {
          await putStorageObject({ key: storageKey, body: bytes, contentType: binaryValidation.detectedMimeType, contentLength: file.size });
          return storageUrlForKey(storageKey);
        }
        await ensureDir();
        await fs.writeFile(path.join(UPLOAD_DIR, filename), bytes);
        return `/uploads/contracts/${filename}`;
      },
    });
    if (!stored.ok) return jsonNoStore({ error: { message: 'Limite diário de upload da conta excedido.' } }, { status: 413 });
    const url = stored.result;

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
