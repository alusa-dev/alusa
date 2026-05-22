import { NextRequest, NextResponse } from 'next/server';

import { updateCostume, updateCostumeSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { costumeId: string } };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getEventsContext('eventCostumes.manage');
    const body = updateCostumeSchema.parse(await request.json());
    return NextResponse.json({ data: await updateCostume(ctx, params.costumeId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_FIGURINO_EVENTO');
  }
}
