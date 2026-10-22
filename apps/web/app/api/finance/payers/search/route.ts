import { NextRequest, NextResponse } from 'next/server';

import { searchFinancePayers } from '@/features/billing/server/finance-payers-search.service';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

export async function GET(request: NextRequest) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const result = await searchFinancePayers(auth.contaId, request.nextUrl.searchParams.get('q') ?? '', {
    sales: request.nextUrl.searchParams.get('context') === 'sales',
  });
  return NextResponse.json(result);
}
