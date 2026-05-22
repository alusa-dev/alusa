import { NextResponse } from 'next/server';

import { listEventResources } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const ctx = await getEventsContext('events.view');
    return NextResponse.json(await listEventResources(ctx));
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_RECURSOS_EVENTOS');
  }
}
