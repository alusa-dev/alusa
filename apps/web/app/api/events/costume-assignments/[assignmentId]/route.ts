import { NextRequest, NextResponse } from 'next/server';

import { updateCostumeAssignment, updateCostumeAssignmentSchema } from '@alusa/lib';

import { getEventsContext, handleEventsRouteError } from '../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: { assignmentId: string } };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const body = updateCostumeAssignmentSchema.parse(await request.json());
    const permission =
      body.status === 'RETURNED'
        ? 'eventCostumes.return'
        : body.status === 'DELIVERED'
          ? 'eventCostumes.deliver'
          : 'eventCostumes.manage';
    const ctx = await getEventsContext(permission);
    return NextResponse.json({ data: await updateCostumeAssignment(ctx, params.assignmentId, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_ENTREGA_FIGURINO');
  }
}
