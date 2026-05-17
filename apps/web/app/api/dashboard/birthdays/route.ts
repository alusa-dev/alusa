import { prisma } from '@/lib/prisma';
import { cachedDashboardBlock, publicImageUrl, requireDashboardBlockContaId } from '../_blocks';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlock(auth.contaId, 'birthdays', async () => {
    const now = new Date();
    const rows = await prisma.aluno.findMany({
      where: { contaId: auth.contaId, status: 'ATIVO' },
      select: { id: true, nome: true, foto: true, dataNasc: true },
    });

    const aniversariantesDoMes = rows
      .sort((a, b) => {
        const monthDiff = a.dataNasc.getMonth() - b.dataNasc.getMonth();
        if (monthDiff !== 0) return monthDiff;
        const dayDiff = a.dataNasc.getDate() - b.dataNasc.getDate();
        if (dayDiff !== 0) return dayDiff;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      })
      .map((aluno) => ({
        id: aluno.id,
        nome: aluno.nome,
        foto: publicImageUrl(aluno.foto),
        dia: aluno.dataNasc.getDate(),
        mes: aluno.dataNasc.getMonth() + 1,
        dataNascimento: aluno.dataNasc.toISOString(),
      }));

    return {
      success: true,
      data: {
        aniversariantesDoMes,
        aniversariantesDoMesAtivos: aniversariantesDoMes.filter((item) => item.mes === now.getMonth() + 1).length,
      },
    };
  });
}
