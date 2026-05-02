import { NextRequest, NextResponse } from 'next/server';
import { NoSuchKey } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { safeGetServerSession } from '@/lib/safe-server-session';
import { getStorageObject, isAllowedStorageKey, isR2Configured, storageUrlForKey } from '@/lib/r2-storage';

export const dynamic = 'force-dynamic';

type SessionUser = { id?: string | null; contaId?: string | null };

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function shortKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function keyArea(key: string): string {
  return key.split('/').slice(0, 2).join('/');
}

function fileNameFromKey(key: string): string {
  return key.split('/').at(-1) ?? '';
}

function legacyUploadUrlForKey(key: string): string | null {
  if (!key.startsWith('uploads/')) return null;
  return `/${key}`;
}

function urlCandidatesForKey(key: string): string[] {
  const legacyUrl = legacyUploadUrlForKey(key);
  return [storageUrlForKey(key), ...(legacyUrl ? [legacyUrl] : [])];
}

function localPathForKey(key: string): string | null {
  if (!key.startsWith('uploads/')) return null;

  const relativePath = key.slice('uploads/'.length);
  const filePath = path.join(LOCAL_UPLOAD_ROOT, relativePath);
  const resolvedRoot = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolvedPath;
}

async function getLocalStorageObject(key: string): Promise<{
  bytes: Uint8Array;
  contentLength: number;
  contentType: string | null;
}> {
  const filePath = localPathForKey(key);
  if (!filePath) {
    const error = new Error('Arquivo nao encontrado.');
    error.name = 'NoSuchKey';
    throw error;
  }

  const buffer = await fs.readFile(filePath);
  return {
    bytes: new Uint8Array(buffer),
    contentLength: buffer.byteLength,
    contentType: CONTENT_TYPES_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null,
  };
}

async function canAccessWithPublicContractToken(key: string, token: string | null): Promise<boolean> {
  if (!token || !key.startsWith('uploads/contratos/')) return false;

  const urls = urlCandidatesForKey(key);
  const contrato = await prisma.contrato.findFirst({
    where: {
      tokenPublico: token,
      arquivoPdfUrl: { in: urls },
      status: { notIn: ['CANCELADO', 'EXPIRADO'] },
    },
    select: {
      tokenExpiraEm: true,
    },
  });

  if (!contrato) return false;
  return !contrato.tokenExpiraEm || contrato.tokenExpiraEm >= new Date();
}

async function isCobrancaFileOwner(key: string, contaId: string): Promise<boolean> {
  if (!key.startsWith('uploads/cobrancas/')) return false;

  const nomeArquivo = fileNameFromKey(key);
  const urls = urlCandidatesForKey(key);

  const arquivoCobranca = await prisma.arquivoCobranca.findFirst({
    where: {
      OR: [{ nomeArquivo }, { url: { in: urls } }],
      cobranca: {
        matricula: {
          aluno: {
            contaId,
          },
        },
      },
    },
    select: { id: true },
  });

  if (arquivoCobranca) return true;

  const arquivoCharge = await prisma.arquivoCharge.findFirst({
    where: {
      OR: [{ nomeArquivo }, { url: { in: urls } }],
      charge: {
        contaId,
      },
    },
    select: { id: true },
  });

  return Boolean(arquivoCharge);
}

async function isContratoFileOwner(key: string, contaId: string): Promise<boolean> {
  if (!key.startsWith('uploads/contratos/')) return false;

  const urls = urlCandidatesForKey(key);

  const modelo = await prisma.contratoModelo.findFirst({
    where: {
      contaId,
      OR: [{ arquivoPdfUrl: { in: urls } }, { arquivoOriginalUrl: { in: urls } }],
    },
    select: { id: true },
  });

  if (modelo) return true;

  const contrato = await prisma.contrato.findFirst({
    where: {
      arquivoPdfUrl: { in: urls },
      matricula: {
        aluno: {
          contaId,
        },
      },
    },
    select: { id: true },
  });

  return Boolean(contrato);
}

async function isProductImageOwner(key: string, contaId: string): Promise<boolean> {
  if (!key.startsWith('uploads/produtos/')) return false;

  const urls = urlCandidatesForKey(key);

  const image = await prisma.productImage.findFirst({
    where: {
      url: { in: urls },
      product: {
        contaId,
      },
    },
    select: { id: true },
  });

  if (image) return true;

  const variant = await prisma.productVariant.findFirst({
    where: {
      imageUrl: { in: urls },
      product: {
        contaId,
      },
    },
    select: { id: true },
  });

  return Boolean(variant);
}

async function isAvatarOwner(key: string, contaId: string): Promise<boolean> {
  if (!key.startsWith('uploads/avatars/') && key.split('/').length !== 2) return false;

  const urls = urlCandidatesForKey(key);
  const where = { contaId, foto: { in: urls } };

  const [usuario, aluno, professor, colaborador] = await Promise.all([
    prisma.usuario.findFirst({ where, select: { id: true } }),
    prisma.aluno.findFirst({ where, select: { id: true } }),
    prisma.professor.findFirst({ where, select: { id: true } }),
    prisma.colaborador.findFirst({ where, select: { id: true } }),
  ]);

  return Boolean(usuario || aluno || professor || colaborador);
}

async function canAccessPrivateFile(key: string, contaId: string): Promise<boolean> {
  if (await isCobrancaFileOwner(key, contaId)) return true;
  if (await isContratoFileOwner(key, contaId)) return true;
  if (await isProductImageOwner(key, contaId)) return true;
  if (await isAvatarOwner(key, contaId)) return true;
  return false;
}

export async function GET(req: NextRequest, context: { params: { key?: string[] } }) {
  const key = (context.params.key ?? []).join('/');
  if (!isAllowedStorageKey(key)) {
    return NextResponse.json({ error: 'Arquivo invalido.' }, { status: 400 });
  }

  try {
    const publicToken = req.nextUrl.searchParams.get('contratoToken');
    const isPublicContractFile = await canAccessWithPublicContractToken(key, publicToken);

    if (!isPublicContractFile) {
      const session = await safeGetServerSession();
      const user = (session as { user?: SessionUser } | null)?.user;

      if (!user?.id || !user?.contaId) {
        return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });
      }

      const canAccess = await canAccessPrivateFile(key, user.contaId);
      if (!canAccess) {
        return NextResponse.json({ error: 'Arquivo nao encontrado.' }, { status: 404 });
      }
    }

    const storageObject = isR2Configured()
      ? await getStorageObject(key).then(async (object) => ({
          bytes: object.Body ? await object.Body.transformToByteArray() : new Uint8Array(),
          contentType: object.ContentType ?? null,
          contentLength: object.ContentLength,
        }))
      : await getLocalStorageObject(key);

    const headers = new Headers();
    headers.set('cache-control', 'private, max-age=300');
    if (storageObject.contentType) headers.set('content-type', storageObject.contentType);
    if (storageObject.contentLength !== undefined) {
      headers.set('content-length', String(storageObject.contentLength));
    }

    return new Response(storageObject.bytes, { status: 200, headers });
  } catch (error) {
    if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ error: 'Arquivo nao encontrado.' }, { status: 404 });
    }

    console.error('[GET /api/files/[...key]]', {
      keyArea: keyArea(key),
      keyHash: shortKeyHash(key),
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Erro ao buscar arquivo.' }, { status: 500 });
  }
}
