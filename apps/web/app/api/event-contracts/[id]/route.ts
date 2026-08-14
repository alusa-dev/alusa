import { NextRequest, NextResponse } from 'next/server';
import { getEventContract } from '@alusa/lib';
import { getEventsContext, handleEventsRouteError } from '../../events/_helpers';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getEventsContext('events.view');
    const { id } = await params;
    const contract = await getEventContract(ctx, id);
    if (!contract) return NextResponse.json({ error: { message: 'Contrato do evento não encontrado.' } }, { status: 404 });
    return NextResponse.json({ data: contract });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_BUSCAR_CONTRATO_EVENTO');
  }
}
