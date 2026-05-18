import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import {
  isDataImageUrl,
  isExternalImageUrl,
  type AvatarEntity,
} from '@/lib/media/avatar-url';
import { storageKeyFromUrl } from '@/lib/r2-storage';
import {
  loadAvatarRecord,
  parseDataImagePayload,
} from '@/src/server/media/avatar-loader.service';

export const dynamic = 'force-dynamic';

const ALLOWED_ENTITIES = new Set<AvatarEntity>(['aluno', 'responsavel', 'colaborador', 'user']);

function isAvatarEntity(value: string): value is AvatarEntity {
  return ALLOWED_ENTITIES.has(value as AvatarEntity);
}

export async function GET(
  req: NextRequest,
  context: { params: { entity: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;
  if (!contaId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const entity = context.params.entity;
  const id = context.params.id;
  if (!isAvatarEntity(entity) || !id) {
    return NextResponse.json({ error: 'Entidade inválida' }, { status: 400 });
  }

  const record = await loadAvatarRecord({ entity, id, contaId });
  if (!record?.foto) {
    return NextResponse.json({ error: 'Avatar não encontrado' }, { status: 404 });
  }

  const foto = record.foto.trim();
  const version = req.nextUrl.searchParams.get('v');

  if (isExternalImageUrl(foto) || foto.startsWith('/api/files/')) {
    const target = foto.startsWith('/api/files/') ? new URL(foto, req.nextUrl.origin) : foto;
    return NextResponse.redirect(target, 307);
  }

  if (storageKeyFromUrl(foto)) {
    return NextResponse.redirect(new URL(foto, req.nextUrl.origin), 307);
  }

  if (!isDataImageUrl(foto)) {
    return NextResponse.json({ error: 'Avatar indisponível' }, { status: 404 });
  }

  const payload = parseDataImagePayload(foto);
  if (!payload) {
    return NextResponse.json({ error: 'Avatar inválido' }, { status: 422 });
  }

  const headers = new Headers();
  headers.set('content-type', payload.mime);
  headers.set('content-length', String(payload.buffer.length));
  headers.set(
    'cache-control',
    version
      ? 'private, max-age=86400, stale-while-revalidate=604800'
      : 'private, max-age=300, stale-while-revalidate=3600',
  );

  return new Response(payload.buffer, { status: 200, headers });
}
