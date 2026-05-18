import { autoCloseAgendaEventsInRange } from '@/src/server/aulas/agenda/agenda-event-auto-close.service';
import { cachedDashboardBlockWithTenant, requireDashboardBlockContaId } from '../_blocks';

type LessonEvent = { turmaId: string | null; status: string; startAt: Date; endAt: Date };

function launchState(event: LessonEvent) {
  const now = new Date();
  if (event.status === 'CANCELADO') return 'CANCELADA';
  if (event.status === 'REALIZADO') return 'REALIZADA';
  if (event.startAt.getTime() <= now.getTime() && event.endAt.getTime() >= now.getTime()) return 'EM_ANDAMENTO';
  return 'PENDENTE';
}

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlockWithTenant(auth.contaId, 'lesson-summary', async (tx) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    await autoCloseAgendaEventsInRange({
      contaId: auth.contaId,
      start: startOfToday,
      end: endOfToday,
      prismaClient: tx,
    });

    const events = await tx.calendarEvent.findMany({
      where: {
        contaId: auth.contaId,
        startAt: { lt: endOfToday },
        endAt: { gt: startOfToday },
        tipo: { in: ['AULA', 'REPOSICAO'] },
      },
      select: { turmaId: true, status: true, startAt: true, endAt: true },
    });

    const selectedByTurma = new Map<string, string>();
    let aulasHoje = 0;
    for (const event of events) {
      if (event.status !== 'CANCELADO') aulasHoje += 1;
      if (event.turmaId && !selectedByTurma.has(event.turmaId)) {
        selectedByTurma.set(event.turmaId, launchState(event));
      }
    }

    return {
      success: true,
      data: {
        aulasHoje,
        pendencias: Array.from(selectedByTurma.values()).filter((state) => state === 'PENDENTE').length,
      },
    };
  });
}
