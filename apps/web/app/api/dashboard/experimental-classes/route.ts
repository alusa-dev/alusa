import { prisma } from '@/lib/prisma';
import { cachedDashboardBlock, resolveAlunoPublicAvatar, requireDashboardBlockContaId } from '../_blocks';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlock(auth.contaId, 'experimental-classes', async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    end.setDate(end.getDate() + 90);

    const rows = await prisma.aulaExperimental.findMany({
      where: {
        contaId: auth.contaId,
        status: { in: ['AGENDADA', 'REAGENDADA', 'REALIZADA'] },
        calendarEvent: { startAt: { gte: start, lte: end } },
      },
      orderBy: { calendarEvent: { startAt: 'asc' } },
      select: {
        id: true,
        alunoId: true,
        status: true,
        aluno: { select: { nome: true, foto: true } },
        calendarEvent: {
          select: {
            titulo: true,
            startAt: true,
            endAt: true,
            turma: { select: { nome: true } },
          },
        },
      },
    });

    return {
      success: true,
      data: {
        aulasExperimentais: rows.map((aula) => {
          const avatarUrl = resolveAlunoPublicAvatar({ id: aula.alunoId, foto: aula.aluno.foto });
          return {
            id: aula.id,
            alunoId: aula.alunoId,
            alunoNome: aula.aluno.nome,
            alunoFoto: avatarUrl,
            alunoAvatarUrl: avatarUrl,
            status: aula.status,
            turmaNome: aula.calendarEvent.turma?.nome ?? aula.calendarEvent.titulo,
            startAt: aula.calendarEvent.startAt.toISOString(),
            endAt: aula.calendarEvent.endAt.toISOString(),
          };
        }),
      },
    };
  });
}
