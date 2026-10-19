import { NextResponse } from 'next/server';

import { getTenantRuntimeHealth } from '@/lib/prisma-tenant';
import { hasCronSecret } from '@/lib/security/route-protection-registry';

function isAuthorized(req: Request) {
  return hasCronSecret(req);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const contaId = searchParams.get('contaId')?.trim();

  if (!contaId) {
    return NextResponse.json({ ok: false, error: 'contaId is required' }, { status: 400 });
  }

  const health = await getTenantRuntimeHealth(contaId);

  return NextResponse.json(
    {
      ok: true,
      data: health,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

