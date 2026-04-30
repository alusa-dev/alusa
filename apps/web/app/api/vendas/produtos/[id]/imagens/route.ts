import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  listProductImages,
  addProductImage,
  reorderProductImages,
} from '@alusa/lib/server';
import { validateUploadBuffer } from '@/lib/upload-security';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string } | Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId } = await Promise.resolve(context.params);
    const images = await listProductImages(productId, contaId);
    return NextResponse.json({ data: images });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_IMAGENS', (e as Error).message);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId } = await Promise.resolve(context.params);

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return jsonError(422, 'ARQUIVO_INVALIDO', 'Envie um arquivo de imagem no campo "file"');
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const uint8 = new Uint8Array(arrayBuffer);

    const validation = validateUploadBuffer({
      buffer: uint8,
      fileName: file.name,
      declaredMimeType: file.type,
      fileSize: file.size,
      maxSizeBytes: MAX_SIZE_BYTES,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      allowedExtensions: ALLOWED_EXTENSIONS,
    });

    if (!validation.ok) {
      return jsonError(422, 'ARQUIVO_INVALIDO', validation.error);
    }

    const image = await addProductImage({
      productId,
      contaId,
      fileBuffer: buffer,
      fileName: file.name,
      mimeType: validation.detectedMimeType,
      fileSize: file.size,
    });

    return NextResponse.json({ data: image }, { status: 201 });
  } catch (e) {
    return jsonError(400, 'ERRO_UPLOAD_IMAGEM', (e as Error).message);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    const contaId = (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');

    const { id: productId } = await Promise.resolve(context.params);
    const body = await req.json();

    if (!Array.isArray(body.orderedIds)) {
      return jsonError(422, 'DADOS_INVALIDOS', '"orderedIds" deve ser um array de IDs');
    }

    await reorderProductImages(productId, contaId, body.orderedIds as string[]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_REORDENAR_IMAGENS', (e as Error).message);
  }
}
