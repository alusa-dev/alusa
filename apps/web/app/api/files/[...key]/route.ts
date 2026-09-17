import { NextRequest, NextResponse } from 'next/server';
import { NoSuchKey } from '@aws-sdk/client-s3';
import { storageFileRouteParamsDTOSchema } from '@/features/storage/dtos';
import { getStorageObject, isAllowedStorageKey, isR2Configured } from '@/lib/r2-storage';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { canReadStorageKey } from '@/src/server/media/storage-access.service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, context: { params: Promise<{ key?: string[] }> }) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Storage indisponivel.' }, { status: 404 });
  }

  const params = await context.params;
  const parsedParams = storageFileRouteParamsDTOSchema.safeParse({ key: params.key ?? [] });
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Arquivo invalido.' }, { status: 400 });
  }
  const key = parsedParams.data.key.join('/');
  if (!isAllowedStorageKey(key)) {
    return NextResponse.json({ error: 'Arquivo invalido.' }, { status: 400 });
  }

  const auth = await resolveTenantSession();
  if (!auth.ok || !(await canReadStorageKey({ key, userId: auth.userId, contaId: auth.contaId }))) {
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
