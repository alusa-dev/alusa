import { NextResponse } from 'next/server';

import { autoCloseAgendaEventsJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  autoCloseAgendaEventsInRange,
  listContasWithAgendaEventsToAutoClose,
} from '@/src/server/aulas/agenda/agenda-event-auto-close.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function dayBounds(reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const end = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/**
 * POST /api/jobs/auto-close-agenda-events
 *
 * Fecha eventos de agenda elegíveis (substitui auto-close em GETs do dashboard).
 * Query: contaId (opcional) — sem contaId, processa contas com eventos no dia.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const query = autoCloseAgendaEventsJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
    });
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: query.contaId,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const { start, end } = dayBounds();
    const contaId = tenantScope.contaId;

    if (contaId) {
      const result = await autoCloseAgendaEventsInRange({ contaId, start, end });
      return NextResponse.json({ success: true, processedContas: 1, closed: result.closed });
    }

    const contaIds = await listContasWithAgendaEventsToAutoClose({ start, end });

    let closed = 0;
    for (const contaId of contaIds) {
      const result = await autoCloseAgendaEventsInRange({
        contaId,
        start,
        end,
      });
      closed += result.closed;
    }

    return NextResponse.json({
      success: true,
      processedContas: contaIds.length,
      closed,
    });
  } catch (error) {
    console.error('[jobs/auto-close-agenda-events]', error);
    return NextResponse.json(
      { success: false, error: 'Não foi possível fechar automaticamente os eventos da agenda.' },
      { status: 500 },
    );
  }
}
