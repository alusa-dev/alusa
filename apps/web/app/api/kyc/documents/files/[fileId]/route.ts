import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { deleteKycDocumentFile, updateKycDocumentFile, viewKycDocumentFile } from '@alusa/finance';
import { validateUploadBuffer } from '@/lib/upload-security';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);
const MAX_ID_LEN = 200;

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

function isValidOpaqueId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.length > MAX_ID_LEN) return false;
  if (/[\s/]/.test(normalized)) return false;
  return true;
}

interface RouteContext {
  params: { fileId: string } | Promise<{ fileId: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  const user = await resolveAuth();
  if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
  if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

  const { fileId } = await Promise.resolve(context.params);
  if (!isValidOpaqueId(fileId)) {
    return json(400, { code: 'INVALID_FILE_ID', message: 'fileId inválido.', fileId: typeof fileId === 'string' ? fileId : null });
  }

  try {
    const data = await viewKycDocumentFile({ contaId: user.contaId, fileId });
    return json(200, { data });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message?.toLowerCase().includes('não encontrado')) {
      return json(404, { error: 'ARQUIVO_NAO_ENCONTRADO' });
    }
    console.error('[Finance KYC Document File][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const user = await resolveAuth();
  if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
  if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

  const { fileId } = await Promise.resolve(context.params);
  if (!isValidOpaqueId(fileId)) {
    return json(400, { code: 'INVALID_FILE_ID', message: 'fileId inválido.', fileId: typeof fileId === 'string' ? fileId : null });
  }

  try {
    const result = await deleteKycDocumentFile({ contaId: user.contaId, fileId, actor: { type: 'USER', id: user.id } });
    return json(200, { data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message?.toLowerCase().includes('não encontrado')) {
      return json(404, { error: 'ARQUIVO_NAO_ENCONTRADO' });
    }
    console.error('[Finance KYC Document File][DELETE]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

/**
 * POST /api/kyc/documents/files/[fileId]
 *
 * Atualiza/substitui um arquivo já enviado no Asaas.
 * Aceita multipart/form-data com:
 *   - documentFile: arquivo (PDF, JPG, PNG, max 10MB)
 */
export async function POST(req: Request, context: RouteContext) {
  const user = await resolveAuth();
  if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
  if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

  const { fileId } = await Promise.resolve(context.params);
  if (!isValidOpaqueId(fileId)) {
    return json(400, { code: 'INVALID_FILE_ID', message: 'fileId inválido.', fileId: typeof fileId === 'string' ? fileId : null });
  }

  try {
    const formData = await req.formData();
    const documentFile = formData.get('documentFile');

    if (!documentFile || !(documentFile instanceof File)) {
      return json(422, { error: 'ARQUIVO_INVALIDO' });
    }

    if (!ALLOWED_TYPES.has(documentFile.type)) {
      return json(422, { error: 'TIPO_ARQUIVO_INVALIDO' });
    }

    const lowerName = documentFile.name.toLowerCase();
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasAllowedExtension) {
      return json(422, { error: 'TIPO_ARQUIVO_INVALIDO' });
    }

    if (documentFile.size > MAX_SIZE) {
      return json(422, { error: 'ARQUIVO_MUITO_GRANDE' });
    }

    const bytes = new Uint8Array(await documentFile.arrayBuffer());
    const binaryValidation = validateUploadBuffer({
      buffer: bytes,
      fileName: documentFile.name,
      declaredMimeType: documentFile.type,
      fileSize: documentFile.size,
      maxSizeBytes: MAX_SIZE,
      allowedMimeTypes: [...ALLOWED_TYPES],
      allowedExtensions: ALLOWED_EXTENSIONS,
    });

    if (!binaryValidation.ok) {
      return json(422, { error: 'CONTEUDO_ARQUIVO_INVALIDO', message: binaryValidation.error });
    }

    const data = await updateKycDocumentFile({
      contaId: user.contaId,
      fileId,
      file: {
        bytes,
        filename: documentFile.name,
        mimeType: binaryValidation.detectedMimeType,
      },
      actor: { type: 'USER', id: user.id },
    });

    return json(200, { data });
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message?.toLowerCase().includes('não encontrado')) {
      return json(404, { error: 'ARQUIVO_NAO_ENCONTRADO' });
    }
    if (message?.toLowerCase().includes('aprovado')) {
      return json(409, { code: 'DOCUMENT_APPROVED', message });
    }
    console.error('[Finance KYC Document File][POST]', error);
    return json(500, { error: 'ERRO_INTERNO', message });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
