import { NextResponse } from 'next/server';

import { getTenantRuntimeHealth } from '@/lib/prisma-tenant';

function isAuthorized(req: Request) {
  const configuredToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
  if (!configuredToken) return false;

  const cronToken = req.headers.get('x-cron-token');
  const authorization = req.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;

  return cronToken === configuredToken || bearerToken === configuredToken;
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

