import { NextRequest, NextResponse } from 'next/server';
import { NoSuchKey } from '@aws-sdk/client-s3';
import { getStorageObject, isAllowedStorageKey, isR2Configured } from '@/lib/r2-storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, context: { params: { key?: string[] } }) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Storage indisponivel.' }, { status: 404 });
  }

  const key = (context.params.key ?? []).join('/');
  if (!isAllowedStorageKey(key)) {
    return NextResponse.json({ error: 'Arquivo invalido.' }, { status: 400 });
  }

  try {
    const object = await getStorageObject(key);
    const bytes = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
    const headers = new Headers();
    headers.set('cache-control', 'private, max-age=300');
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
