import { NextResponse } from 'next/server';
import { productImagesReorderInputDTOSchema } from '@/features/sales/dtos';
import {
  listProductImages,
  addProductImage,
  reorderProductImages,
  deleteProductImage,
} from '@alusa/lib/server';
import { validateUploadBuffer } from '@/lib/upload-security';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { readBoundedFormData } from '@/lib/upload-request';
import { withTenantUploadQuota } from '@/lib/upload-quota.server';
import { randomUUID } from 'node:crypto';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
const MAX_SIZE_BYTES = 3 * 1024 * 1024;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface RouteContext {
  params: { id: string } | Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId } = await Promise.resolve(context.params);
    const images = await listProductImages(productId, contaId);
    return NextResponse.json({ data: images });
  } catch (e) {
    return jsonError(500, 'ERRO_LISTAR_IMAGENS', 'Não foi possível carregar as imagens.');
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;
    const limiter = await rateLimitAsync(`product-image:${contaId}:${auth.userId}:${ipFromRequest(req)}`, 20, 10 * 60_000);
    if (!limiter.ok) return jsonError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.');

    const { id: productId } = await Promise.resolve(context.params);

    const parsedBody = await readBoundedFormData(req);
    if (!parsedBody.ok) return jsonError(parsedBody.status, 'UPLOAD_BODY_LIMIT', parsedBody.error);
    const formData = parsedBody.formData;
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

    let imageId: string | null = null;
    const quota = await withTenantUploadQuota({
      contaId,
      fileSize: file.size,
      contentType: validation.detectedMimeType,
      objectKey: `uploads/product-image-reservations/${contaId}/${randomUUID()}`,
      cleanup: async () => { if (imageId) await deleteProductImage(imageId, productId, contaId).catch(() => undefined); },
      action: async () => {
        const created = await addProductImage({ productId, contaId, fileBuffer: buffer, fileName: file.name, mimeType: validation.detectedMimeType, fileSize: file.size });
        imageId = created.id;
        return created;
      },
    });
    if (!quota.ok) return jsonError(413, 'UPLOAD_QUOTA_EXCEEDED', 'Limite diário de upload da conta excedido.');
    return NextResponse.json({ data: quota.result }, { status: 201 });
  } catch (e) {
    return jsonError(400, 'ERRO_UPLOAD_IMAGEM', (e as Error).message);
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    const { contaId } = auth;

    const { id: productId } = await Promise.resolve(context.params);
    const parsed = productImagesReorderInputDTOSchema.safeParse(await req.json());
    if (!parsed.success) return jsonError(422, 'DADOS_INVALIDOS', '"orderedIds" deve ser um array de IDs');

    await reorderProductImages(productId, contaId, parsed.data.orderedIds);
    return NextResponse.json({ success: true });
  } catch (e) {
    return jsonError(400, 'ERRO_REORDENAR_IMAGENS', (e as Error).message);
  }
}
