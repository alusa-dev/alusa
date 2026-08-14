import { NextRequest, NextResponse } from 'next/server';
import { NoSuchKey } from '@aws-sdk/client-s3';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { getStorageObject, isAllowedStorageKey, isR2Configured } from '@/lib/r2-storage';

export const dynamic = 'force-dynamic';

type SessionUser = { id?: string; contaId?: string };

function storageUrlForRequestKey(key: string): string {
  return `/api/files/${encodeURI(key.replace(/^\/+/, ''))}`;
}

async function canReadStorageKey(key: string, user: SessionUser): Promise<boolean> {
  if (!user.id || !user.contaId) return false;

  const url = storageUrlForRequestKey(key);
  const filename = key.split('/').pop() ?? '';

  // Avatares de pessoas são gravados em pastas separadas por entidade. A
  // autorização deve consultar o registro dentro da conta ativa, nunca
  // confiar apenas no caminho enviado pelo cliente.
  const avatarMatch = /^uploads\/(alunos|responsaveis|colaboradores)\/([^/]+)\/([^/]+)\/avatar\.[a-z0-9]+$/i.exec(key);
  if (avatarMatch) {
    const [, folder, keyContaId, entityId] = avatarMatch;
    if (keyContaId !== user.contaId) return false;
    const entity = folder === 'alunos'
      ? 'aluno'
      : folder === 'responsaveis'
        ? 'responsavel'
        : 'colaborador';

    if (entity === 'aluno') {
      const record = await prisma.aluno.findFirst({
        where: { id: entityId, contaId: user.contaId, foto: url },
        select: { id: true },
      });
      return Boolean(record);
    }

    if (entity === 'responsavel') {
      const record = await prisma.responsavel.findFirst({
        where: { id: entityId, contaId: user.contaId, foto: url },
        select: { id: true },
      });
      return Boolean(record);
    }

    const record = await prisma.colaborador.findFirst({
      where: { id: entityId, contaId: user.contaId, foto: url },
      select: { id: true },
    });
    return Boolean(record);
  }

  if (key.startsWith('uploads/avatars/')) {
    const scopedPrefix = `${user.contaId}-${user.id}-`;
    if (filename.startsWith(scopedPrefix)) return true;

    const avatarOwner = await prisma.usuario.findFirst({
      where: {
        id: user.id,
        contaId: user.contaId,
        foto: url,
      },
      select: { id: true },
    });
    return Boolean(avatarOwner);
  }

  if (key.startsWith('uploads/produtos/')) {
    const image = await prisma.productImage.findFirst({
      where: {
        url,
        product: { contaId: user.contaId },
      },
      select: { id: true },
    });
    if (image) return true;

    const variant = await prisma.productVariant.findFirst({
      where: {
        imageUrl: url,
        product: { contaId: user.contaId },
      },
      select: { id: true },
    });
    return Boolean(variant);
  }

  if (key.startsWith('uploads/cobrancas/')) {
    const arquivoCobranca = await prisma.arquivoCobranca.findFirst({
      where: {
        url,
        cobranca: { contaId: user.contaId },
      },
      select: { id: true },
    });
    if (arquivoCobranca) return true;

    const arquivoChargeClient = (
      prisma as typeof prisma & {
        arquivoCharge?: {
          findFirst: (args: {
            where: { url: string; charge: { contaId: string } };
            select: { id: true };
          }) => Promise<{ id: string } | null>;
        };
      }
    ).arquivoCharge;

    if (!arquivoChargeClient) return false;
    const arquivoCharge = await arquivoChargeClient.findFirst({
      where: { url, charge: { contaId: user.contaId } },
      select: { id: true },
    });
    return Boolean(arquivoCharge);
  }

  if (key.startsWith('uploads/contratos/')) {
    const contrato = await prisma.contrato.findFirst({
      where: {
        arquivoPdfUrl: url,
        matricula: { contaId: user.contaId },
      },
      select: { id: true },
    });
    if (contrato) return true;

    const modelo = await prisma.contratoModelo.findFirst({
      where: {
        contaId: user.contaId,
        OR: [{ arquivoPdfUrl: url }, { arquivoOriginalUrl: url }],
      },
      select: { id: true },
    });
    return Boolean(modelo);
  }

  return false;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ key?: string[] }> }) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Storage indisponivel.' }, { status: 404 });
  }

  const params = await context.params;
  const key = (params.key ?? []).join('/');
  if (!isAllowedStorageKey(key)) {
    return NextResponse.json({ error: 'Arquivo invalido.' }, { status: 400 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: SessionUser } | null)?.user ?? {};
  if (!(await canReadStorageKey(key, user))) {
    return NextResponse.json(
      { error: 'Arquivo não encontrado.' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const object = await getStorageObject(key);
    const bytes = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
    const headers = new Headers();
    headers.set('cache-control', 'private, max-age=300');
    headers.set('x-content-type-options', 'nosniff');
    if (object.ContentType) headers.set('content-type', object.ContentType);
    if (object.ContentLength !== undefined) headers.set('content-length', String(object.ContentLength));

    const body = new Uint8Array(bytes).buffer;
    return new Response(body, { status: 200, headers });
  } catch (error) {
    if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ error: 'Arquivo nao encontrado.' }, { status: 404 });
    }

    console.error('[GET /api/files/[...key]]', error);
    return NextResponse.json({ error: 'Erro ao buscar arquivo.' }, { status: 500 });
  }
}
