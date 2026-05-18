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

  return true;
}

export async function GET(_req: NextRequest, context: { params: { key?: string[] } }) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Storage indisponivel.' }, { status: 404 });
  }

  const key = (context.params.key ?? []).join('/');
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

    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') {
      return NextResponse.json({ error: 'Arquivo nao encontrado.' }, { status: 404 });
    }

    console.error('[GET /api/files/[...key]]', error);
    return NextResponse.json({ error: 'Erro ao buscar arquivo.' }, { status: 500 });
  }
}
