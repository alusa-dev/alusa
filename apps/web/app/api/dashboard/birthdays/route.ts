import { cachedDashboardBlockWithTenant, resolveAlunoPublicAvatar, requireDashboardBlockContaId } from '../_blocks';
import { avatarVersionFromFoto, resolvePublicAvatarUrl } from '@/lib/media/avatar-url';

export async function GET() {
  const auth = await requireDashboardBlockContaId();
  if (!auth.ok) return auth.response;

  return cachedDashboardBlockWithTenant(auth.contaId, 'birthdays', async (tx) => {
    const now = new Date();
    const [alunos, colaboradores] = await Promise.all([
      tx.aluno.findMany({
      where: { contaId: auth.contaId, status: 'ATIVO' },
      select: { id: true, nome: true, foto: true, dataNasc: true },
      }),
      tx.colaborador.findMany({
        where: { contaId: auth.contaId, status: 'ATIVO', dataNasc: { not: null } },
        select: { id: true, nome: true, nomeSocial: true, foto: true, dataNasc: true },
      }),
    ]);

    const aniversariantesDoMes = [
      ...alunos.map((aluno) => ({ ...aluno, tipo: 'ALUNO' as const })),
      ...colaboradores
        .filter((colaborador) => colaborador.dataNasc !== null)
        .map((colaborador) => ({
          id: colaborador.id,
          nome: colaborador.nomeSocial || colaborador.nome,
          foto: colaborador.foto,
          dataNasc: colaborador.dataNasc as Date,
          tipo: 'COLABORADOR' as const,
        })),
    ]
      .sort((a, b) => {
        const monthDiff = a.dataNasc.getMonth() - b.dataNasc.getMonth();
        if (monthDiff !== 0) return monthDiff;
        const dayDiff = a.dataNasc.getDate() - b.dataNasc.getDate();
        if (dayDiff !== 0) return dayDiff;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      })
      .map((aniversariante) => {
        const avatarUrl = aniversariante.tipo === 'ALUNO'
          ? resolveAlunoPublicAvatar(aniversariante)
          : resolvePublicAvatarUrl({
              entity: 'colaborador',
              id: aniversariante.id,
              foto: aniversariante.foto,
              version: avatarVersionFromFoto(aniversariante.foto),
            });
        return {
          id: aniversariante.id,
          nome: aniversariante.nome,
          tipo: aniversariante.tipo,
          foto: avatarUrl,
          avatarUrl,
          dia: aniversariante.dataNasc.getDate(),
          mes: aniversariante.dataNasc.getMonth() + 1,
          dataNascimento: aniversariante.dataNasc.toISOString(),
        };
      });

    return {
      success: true,
      data: {
        aniversariantesDoMes,
        aniversariantesDoMesAtivos: aniversariantesDoMes.filter((item) => item.mes === now.getMonth() + 1).length,
      },
    };
  });
}
