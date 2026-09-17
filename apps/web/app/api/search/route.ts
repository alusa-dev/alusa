import { NextRequest, NextResponse } from 'next/server';
import { GLOBAL_SEARCH_MIN_QUERY_LENGTH } from '@/features/global-search/constants';
import { globalSearchResultDTOSchema } from '@/features/global-search/dtos';
import { searchGlobalApp } from '@/features/global-search/queries';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
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
    contaId: auth.contaId,
    role: auth.role ?? null,
  });

  return NextResponse.json(result, {
    headers: { 'cache-control': 'no-store' },
  });
}
