import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { extname, join } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import {
  cobrancaArquivoIdQueryDTOSchema,
  cobrancaRouteParamsDTOSchema,
  deleteCobrancaArquivoResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { apiErrorResponse } from '@/lib/api/report-api-error';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import {
  createArquivoForCobranca,
  deleteArquivoForCobranca,
  findArquivoForCobranca,
  listArquivosForCobranca,
  resolveCobrancaRef,
} from '@/lib/financeiro/cobranca-arquivos';
import {
  deleteStorageObject,
  isR2Configured,
  putStorageObject,
  storageKeyFromUrl,
  storageUrlForKey,
} from '@/lib/r2-storage';
import { validateUploadBuffer } from '@/lib/upload-security';

const ROUTE_TAG = 'api.cobrancas.arquivos';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads', 'cobrancas');

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

async function parseCobrancaId(params: RouteContext['params']) {
  const resolved = await Promise.resolve(params);
  return cobrancaRouteParamsDTOSchema.parse(resolved).id;
}

function hasPrefix(buffer: Uint8Array, prefix: readonly number[]) {
  return prefix.every((value, index) => buffer[index] === value);
}

function validateOfficeBuffer(buffer: Uint8Array, extension: string, declaredMimeType: string) {
  const normalized = declaredMimeType.toLowerCase();
  const isZipOffice = extension === '.docx' || extension === '.xlsx';
  const isLegacyOffice = extension === '.doc' || extension === '.xls';

  if (isZipOffice && !hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return false;
  }

  if (isLegacyOffice && !hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return false;
  }

  if (extension === '.docx') {
    return normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (extension === '.xlsx') {
    return normalized === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (extension === '.doc') return normalized === 'application/msword';
  if (extension === '.xls') return normalized === 'application/vnd.ms-excel';

  return false;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const cobrancaId = await parseCobrancaId(context.params);

    const result = await withTenantSession(async ({ contaId, tx }) => {
      const ref = await resolveCobrancaRef(tx, contaId, cobrancaId);
      if (!ref) {
        return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 });
      }

      const body = await listArquivosForCobranca(tx, ref);
      return NextResponse.json(body, { status: 200 });
    });

    return result;
  } catch (error) {
    return apiErrorResponse(error, {
      route: `${ROUTE_TAG}.GET`,
      fallbackMessage: 'Erro ao buscar arquivos',
    });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const cobrancaId = await parseCobrancaId(context.params);

    const result = await withTenantSession(async ({ contaId, userId, tx }) => {
      const ref = await resolveCobrancaRef(tx, contaId, cobrancaId);
      if (!ref) {
        return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 });
      }

      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'Arquivo muito grande. Máximo: 10MB' }, { status: 400 });
      }

      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          {
            error: 'Tipo de arquivo não permitido. Permitidos: PDF, JPG, PNG, DOC, DOCX, XLS, XLSX',
          },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const bytes = new Uint8Array(buffer);
      const extension = extname(file.name).toLowerCase();
      const binaryValidation =
        extension === '.pdf' || extension === '.jpg' || extension === '.jpeg' || extension === '.png'
          ? validateUploadBuffer({
              buffer: bytes,
              fileName: file.name,
              declaredMimeType: file.type,
              fileSize: file.size,
              maxSizeBytes: MAX_FILE_SIZE,
              allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
              allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png'],
            })
          : validateOfficeBuffer(bytes, extension, file.type)
            ? { ok: true as const, extension, detectedMimeType: file.type }
            : { ok: false as const, error: 'Conteúdo do arquivo não permitido.' };

      if (!binaryValidation.ok) {
        return NextResponse.json({ error: binaryValidation.error }, { status: 400 });
      }

      const nomeArquivo = `${contaId}-${randomUUID()}${binaryValidation.extension}`;
      const storageKey = `uploads/cobrancas/${nomeArquivo}`;
      const storageUrl = storageUrlForKey(storageKey);

      if (isR2Configured()) {
        await putStorageObject({
          key: storageKey,
          body: bytes,
          contentType: binaryValidation.detectedMimeType,
          contentLength: file.size,
        });
      } else {
        if (!existsSync(UPLOAD_DIR)) {
          await mkdir(UPLOAD_DIR, { recursive: true });
        }
        await writeFile(join(UPLOAD_DIR, nomeArquivo), bytes);
      }

      const body = await createArquivoForCobranca(tx, ref, {
        nomeOriginal: file.name,
        nomeArquivo,
        mimetype: binaryValidation.detectedMimeType,
        tamanho: file.size,
        url: isR2Configured() ? storageUrl : `/uploads/cobrancas/${nomeArquivo}`,
        uploadPor: userId,
      });

      return NextResponse.json(body, { status: 201 });
    });

    return result;
  } catch (error) {
    return apiErrorResponse(error, {
      route: `${ROUTE_TAG}.POST`,
      fallbackMessage: 'Erro ao fazer upload do arquivo',
    });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const cobrancaId = await parseCobrancaId(context.params);
    const { searchParams } = new URL(req.url);
    const parsedQuery = cobrancaArquivoIdQueryDTOSchema.safeParse({
      arquivoId: searchParams.get('arquivoId') ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json({ error: 'ID do arquivo não fornecido' }, { status: 400 });
    }
    const { arquivoId } = parsedQuery.data;

    const result = await withTenantSession(async ({ contaId, tx }) => {
      const found = await findArquivoForCobranca(tx, contaId, cobrancaId, arquivoId);
      if (!found) {
        return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });
      }

      const r2Key = storageKeyFromUrl(String(found.row.url ?? ''));
      if (r2Key) {
        await deleteStorageObject(r2Key).catch(() => null);
      } else {
        const filePath = join(UPLOAD_DIR, found.row.nomeArquivo);
        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      }

      await deleteArquivoForCobranca(tx, arquivoId, found.kind);

      return NextResponse.json(deleteCobrancaArquivoResultDTOSchema.parse({ success: true }), {
        status: 200,
      });
    });

    return result;
  } catch (error) {
    return apiErrorResponse(error, {
      route: `${ROUTE_TAG}.DELETE`,
      fallbackMessage: 'Erro ao remover arquivo',
    });
  }
}
