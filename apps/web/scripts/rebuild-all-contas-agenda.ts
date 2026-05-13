/**
 * Reconstrói eventos recorrentes da agenda (`TURMA_RECORRENTE`) para todas as contas ativas.
 *
 * Uso (com DATABASE_URL da produção ou ambiente alvo):
 *   cd apps/web && dotenv -e ../../.env -- pnpm exec tsx scripts/rebuild-all-contas-agenda.ts
 */
import { prisma } from '@/src/prisma';
import { resolveAccountTimeZone } from '@/src/server/aulas/calendar/account-timezone';
import {
  materializeCalendarWindow,
  normalizeAgendaRange,
} from '@/src/server/aulas/calendar/calendar-core.service';

async function main() {
  const contas = await prisma.conta.findMany({
    where: { deletedAt: null, status: 'ATIVO' },
    select: { id: true, nome: true },
    orderBy: { nome: 'asc' },
  });

  const anchor = new Date();

  for (const conta of contas) {
    const tz = await resolveAccountTimeZone(conta.id, prisma);
    const range = normalizeAgendaRange(anchor, undefined, tz);
    const summary = await materializeCalendarWindow({
      contaId: conta.id,
      start: range.start,
      end: range.end,
      timeZone: tz,
      logOperation: true,
      logReason: 'ops:rebuild-all-contas-agenda-script',
      prismaClient: prisma,
    });
    console.log(
      `[agenda] ${conta.nome} (${conta.id}): created=${summary.created} updated=${summary.updated} skipped=${summary.skipped} deleted=${summary.deleted}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
