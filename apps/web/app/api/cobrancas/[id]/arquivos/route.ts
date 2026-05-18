import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import { extname, join } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import {
  cobrancaArquivoIdQueryDTOSchema,
  cobrancaRouteParamsDTOSchema,
  deleteCobrancaArquivoResultDTOSchema,
  listCobrancaArquivosResultDTOSchema,
  uploadCobrancaArquivoResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaArquivoToDTO } from '@/features/financeiro/cobrancas/mappers';
import {
  deleteStorageObject,
  isR2Configured,
  putStorageObject,
  storageKeyFromUrl,
  storageUrlForKey,
} from '@/lib/r2-storage';
import { validateUploadBuffer } from '@/lib/upload-security';

// Configuração de upload
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];

const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads', 'cobrancas');

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

/**
 * GET /api/cobrancas/[id]/arquivos
 * Lista todos os arquivos de uma cobrança
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(params);

    // Verificar se cobrança existe e pertence à conta do usuário
    const cobranca = await prisma.cobranca.findFirst({
      where: {
        id,
        matricula: {
          aluno: {
            contaId: session.user.contaId ?? undefined,
          },
        },
      },
    });

    // Se não encontrar em Cobranca, verificar se é uma Charge standalone
    if (!cobranca) {
      const charge = await prisma.charge.findFirst({
        where: {
          id,
          contaId: session.user.contaId ?? undefined,
        },
      });

      if (!charge) {
        return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 });
      }

      const arquivoChargeClient = (
        prisma as typeof prisma & { arquivoCharge?: typeof prisma.arquivoCobranca }
      ).arquivoCharge;

      if (!arquivoChargeClient) {
        return NextResponse.json({ arquivos: [] }, { status: 200 });
      }

      const arquivos = await arquivoChargeClient.findMany({
        where: { chargeId: id },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json(
        listCobrancaArquivosResultDTOSchema.parse({
          arquivos: arquivos.map((arquivo) =>
            mapCobrancaArquivoToDTO(arquivo as unknown as Record<string, unknown>),
          ),
        }),
        { status: 200 },
      );
    }

    const arquivos = await prisma.arquivoCobranca.findMany({
      where: { cobrancaId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(
      listCobrancaArquivosResultDTOSchema.parse({
        arquivos: arquivos.map((arquivo) =>
          mapCobrancaArquivoToDTO(arquivo as unknown as Record<string, unknown>),
        ),
      }),
      { status: 200 },
    );
  } catch (error) {
    console.error('[GET /api/cobrancas/[id]/arquivos] Error:', error);
    return NextResponse.json({ error: 'Erro ao buscar arquivos' }, { status: 500 });
  }
}

/**
 * POST /api/cobrancas/[id]/arquivos
 * Faz upload de um arquivo para uma cobrança
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(params);

    // Verificar se cobrança existe e pertence à conta do usuário
    const cobranca = await prisma.cobranca.findFirst({
      where: {
        id,
        matricula: {
          aluno: {
            contaId: session.user.contaId ?? undefined,
          },
        },
      },
    });

    const charge = !cobranca
      ? await prisma.charge.findFirst({
          where: {
            id,
            contaId: session.user.contaId ?? undefined,
          },
        })
      : null;

    if (!cobranca && !charge) {
      return NextResponse.json({ error: 'Cobrança não encontrada' }, { status: 404 });
    }

    // Parse do multipart/form-data
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    // Validar tamanho
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo muito grande. Máximo: 10MB' }, { status: 400 });
    }

    // Validar tipo
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo não permitido. Permitidos: PDF, JPG, PNG, DOC, DOCX, XLS, XLSX' },
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

    // Gerar nome único para o arquivo
    const nomeArquivo = `${session.user.contaId}-${randomUUID()}${binaryValidation.extension}`;
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
      // Criar diretório se não existir
      if (!existsSync(UPLOAD_DIR)) {
        await mkdir(UPLOAD_DIR, { recursive: true });
      }

      // Salvar arquivo
      const filePath = join(UPLOAD_DIR, nomeArquivo);
      await writeFile(filePath, bytes);
    }

    // Criar registro no banco
    const arquivoChargeClient = (
      prisma as typeof prisma & { arquivoCharge?: typeof prisma.arquivoCobranca }
    ).arquivoCharge;

    if (!cobranca && !arquivoChargeClient) {
      return NextResponse.json(
        { error: 'Upload indisponível para cobrança avulsa' },
        { status: 503 },
      );
    }

    const arquivo = cobranca
      ? await prisma.arquivoCobranca.create({
          data: {
            cobrancaId: id,
            nomeOriginal: file.name,
            nomeArquivo,
            mimetype: binaryValidation.detectedMimeType,
            tamanho: file.size,
            url: isR2Configured() ? storageUrl : `/uploads/cobrancas/${nomeArquivo}`,
            uploadPor: session.user.id,
          },
        })
      : await arquivoChargeClient!.create({
          data: {
            chargeId: id,
            nomeOriginal: file.name,
            nomeArquivo,
            mimetype: binaryValidation.detectedMimeType,
            tamanho: file.size,
            url: isR2Configured() ? storageUrl : `/uploads/cobrancas/${nomeArquivo}`,
            uploadPor: session.user.id,
          },
        });

    return NextResponse.json(
      uploadCobrancaArquivoResultDTOSchema.parse({
        arquivo: mapCobrancaArquivoToDTO(arquivo as unknown as Record<string, unknown>),
      }),
      { status: 201 },
    );
  } catch (error) {
    console.error('[POST /api/cobrancas/[id]/arquivos] Error:', error);
    return NextResponse.json({ error: 'Erro ao fazer upload do arquivo' }, { status: 500 });
  }
}

/**
 * DELETE /api/cobrancas/[id]/arquivos
 * Remove um arquivo de uma cobrança
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id } = cobrancaRouteParamsDTOSchema.parse(params);
    const { searchParams } = new URL(req.url);
    const parsedQuery = cobrancaArquivoIdQueryDTOSchema.safeParse({
      arquivoId: searchParams.get('arquivoId') ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json({ error: 'ID do arquivo não fornecido' }, { status: 400 });
    }
    const { arquivoId } = parsedQuery.data;

    // Verificar se arquivo existe e pertence à cobrança da conta do usuário
    const arquivoCobranca = await prisma.arquivoCobranca.findFirst({
      where: {
        id: arquivoId,
        cobrancaId: id,
        cobranca: {
          matricula: {
            aluno: {
              contaId: session.user.contaId ?? undefined,
            },
          },
        },
      },
    });

    const arquivoChargeClient = (
      prisma as typeof prisma & { arquivoCharge?: typeof prisma.arquivoCobranca }
    ).arquivoCharge;

    const arquivoCharge = !arquivoCobranca && arquivoChargeClient
      ? await arquivoChargeClient.findFirst({
          where: {
            id: arquivoId,
            chargeId: id,
            charge: {
              contaId: session.user.contaId ?? undefined,
            },
          },
        })
      : null;

    if (!arquivoCobranca && !arquivoCharge) {
      return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });
    }

    // Remover arquivo do storage
    const arquivo = (arquivoCobranca ?? arquivoCharge)!;
    const r2Key = storageKeyFromUrl(String(arquivo.url ?? ''));
    if (r2Key) {
      await deleteStorageObject(r2Key).catch(() => null);
    } else {
      const filePath = join(UPLOAD_DIR, arquivo.nomeArquivo);
      if (existsSync(filePath)) {
      const { unlink } = await import('fs/promises');
      await unlink(filePath);
      }
    }

    // Remover registro do banco
    if (arquivoCobranca) {
      await prisma.arquivoCobranca.delete({
        where: { id: arquivoId },
      });
    } else if (arquivoChargeClient) {
      await arquivoChargeClient.delete({
        where: { id: arquivoId },
      });
    }

    return NextResponse.json(deleteCobrancaArquivoResultDTOSchema.parse({ success: true }), {
      status: 200,
    });
  } catch (error) {
    console.error('[DELETE /api/cobrancas/[id]/arquivos] Error:', error);
    return NextResponse.json({ error: 'Erro ao remover arquivo' }, { status: 500 });
  }
}
