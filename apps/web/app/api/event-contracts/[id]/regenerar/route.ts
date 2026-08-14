import { NextRequest, NextResponse } from 'next/server';
import { regenerateEventContractToken } from '@alusa/lib';
import { getEventsContext, handleEventsRouteError } from '../../../events/_helpers';

export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getEventsContext('events.update');
    const { id } = await params;
    return NextResponse.json({ data: await regenerateEventContractToken(ctx, id) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_REGENERAR_CONTRATO_EVENTO');
  }
}
