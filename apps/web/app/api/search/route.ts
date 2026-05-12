import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { GLOBAL_SEARCH_MIN_QUERY_LENGTH } from '@/features/global-search/constants';
import { globalSearchResultDTOSchema } from '@/features/global-search/dtos';
import { searchGlobalApp } from '@/features/global-search/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = session?.user;

  if (!user?.id || !user.contaId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();

  if (query.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    return NextResponse.json(globalSearchResultDTOSchema.parse({ query, groups: [] }), {
      headers: { 'cache-control': 'no-store' },
    });
  }

  const result = await searchGlobalApp(query, {
    contaId: user.contaId,
    role: user.role ?? null,
  });

  return NextResponse.json(result, {
    headers: { 'cache-control': 'no-store' },
  });
}