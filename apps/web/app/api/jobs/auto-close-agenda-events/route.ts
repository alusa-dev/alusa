import { NextResponse } from 'next/server';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { prisma } from '@/src/prisma';
import { autoCloseAgendaEventsInRange } from '@/src/server/aulas/agenda/agenda-event-auto-close.service';

export const dynamic = 'force-dynamic';

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
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
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

    const contas = await prisma.calendarEvent.findMany({
      where: {
        startAt: { lt: end },
        endAt: { gt: start },
        tipo: { in: ['AULA', 'REPOSICAO'] },
        status: 'AGENDADO',
      },
      distinct: ['contaId'],
      select: { contaId: true },
    });

    let closed = 0;
    for (const row of contas) {
      const result = await autoCloseAgendaEventsInRange({
        contaId: row.contaId,
        start,
        end,
      });
      closed += result.closed;
    }

    return NextResponse.json({
      success: true,
      processedContas: contas.length,
      closed,
    });
  } catch (error) {
    console.error('[jobs/auto-close-agenda-events]', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
