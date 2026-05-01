import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { jsonNoStore } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { validateUploadBuffer } from '@/lib/upload-security';
import {
  deleteStorageObject,
  isR2Configured,
  putStorageObject,
  storageKeyFromUrl,
  storageUrlForKey,
} from '@/lib/r2-storage';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const DEFAULT_MAX_MB = 15;
const MAX_SIZE = (Number(process.env.NEXT_UPLOAD_MAX_MB || process.env.NEXT_PUBLIC_UPLOAD_MAX_MB) || DEFAULT_MAX_MB) * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

async function ensureDir() {
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  } catch {
    // Diretório já existe, ignorar erro
  }
}

function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_SIZE) {
    const mb = Math.floor(MAX_SIZE / (1024 * 1024));
    return { valid: false, error: `Arquivo muito grande. Maximo ${mb}MB.` };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Tipo de arquivo nao permitido. Use JPG, PNG, WebP ou PDF.' };
  }

  if (!ALLOWED_EXTENSIONS.includes(path.extname(file.name).toLowerCase())) {
    return { valid: false, error: 'Extensao de arquivo nao permitida.' };
  }

  return { valid: true };
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return jsonNoStore({ error: 'Nao autorizado.' }, { status: 401 });
    }

    const ip = ipFromRequest(req);
    const limiter = rateLimit(`upload:post:${user.id}:${ip}`, 30, 10 * 60 * 1000);
    if (!limiter.ok) {
      return jsonNoStore({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return jsonNoStore({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }

    const validation = validateFile(file);
    if (!validation.valid) {
      return jsonNoStore({ error: validation.error }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
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
      return jsonNoStore({ error: binaryValidation.error }, { status: 400 });
    }

    const filename = `${user.contaId}-${user.id}-${randomUUID()}${binaryValidation.extension}`;
    let url: string;
    if (isR2Configured()) {
      const key = `uploads/avatars/${filename}`;
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
      url = `/uploads/${filename}`;
    }

    const result = {
      url,
      size: file.size,
      type: binaryValidation.detectedMimeType,
    };

    return jsonNoStore(result);
  } catch (error) {
    console.error('[API /api/upload] Erro no upload:', error);
    return jsonNoStore(
      { error: 'Erro interno do servidor. Tente novamente.' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user?.contaId) {
      return jsonNoStore({ error: 'Nao autorizado.' }, { status: 401 });
    }

    const ip = ipFromRequest(req);
    const limiter = rateLimit(`upload:delete:${user.id}:${ip}`, 60, 10 * 60 * 1000);
    if (!limiter.ok) {
      return jsonNoStore({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
    }

    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return jsonNoStore({ error: 'URL inválida.' }, { status: 400 });
    }

    const r2Key = storageKeyFromUrl(url);
    if (!r2Key && !/^\/uploads\/[^/]+$/.test(url)) {
      return jsonNoStore({ error: 'Caminho não permitido.' }, { status: 400 });
    }

    const filename = r2Key ? path.basename(r2Key) : path.basename(url);
    const filePath = path.join(UPLOAD_DIR, filename);

    const resolvedPath = path.resolve(filePath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return jsonNoStore({ error: 'Caminho não permitido.' }, { status: 400 });
    }

    const scopedPrefix = `${user.contaId}-${user.id}-`;
    let canDelete = filename.startsWith(scopedPrefix);

    if (!canDelete) {
      const ownsLegacyAvatar = await prisma.usuario.findFirst({
        where: {
          id: user.id,
          contaId: user.contaId,
          foto: url,
        },
        select: { id: true },
      });
      canDelete = Boolean(ownsLegacyAvatar);
    }

    if (!canDelete) {
      return jsonNoStore({ error: 'Você só pode remover seus próprios arquivos.' }, { status: 403 });
    }

    if (r2Key) {
      await deleteStorageObject(r2Key).catch(() => null);
    } else {
      try {
        await fs.unlink(filePath);
      } catch {
        // Arquivo não existe, tudo bem.
      }
    }

    return jsonNoStore({ success: true });
  } catch (error) {
    console.error('[API /api/upload] Erro ao deletar arquivo:', error);
    return jsonNoStore(
      { error: 'Erro interno do servidor.' },
      { status: 500 },
    );
  }
}
