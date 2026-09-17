import { NextResponse } from 'next/server';
import { requirePortalUser, resolvePortalAlunoIds } from '@/features/portal/api-helpers';
import { portalMatriculasResultDTOSchema } from '@/features/portal/dtos';
import { mapPortalMatriculaToDTO, mapPortalMatriculasResultToDTO } from '@/features/portal/mappers';
import { listPortalMatriculas } from '@/src/server/portal/portal-read.service';

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const alunoIds = await resolvePortalAlunoIds(auth.user);

    // 4. Buscar matrículas dos alunos
    const matriculas = await listPortalMatriculas({ contaId: auth.user.contaId, alunoIds });

    // 5. Formatar dados
    const matriculasFormatadas = matriculas.map((m) => {
      const turmaFallback = m.matriculaTurmas.find((mt) => mt.turma)?.turma;
      const turmaSelecionada = m.turma ?? turmaFallback ?? null;

      return {
        id: m.id,
        status: m.status,
        dataInicio: m.dataInicio.toISOString(),
        dataFimContrato: m.dataFimContrato.toISOString(),
        aluno: {
          nome: m.aluno.nome,
          foto: m.aluno.foto,
        },
        turma: turmaSelecionada
          ? {
              nome: turmaSelecionada.nome,
              modalidade: {
                nome: turmaSelecionada.modalidade?.nome,
              },
            }
          : null,
        diasSemana: turmaSelecionada?.diasSemana ?? null,
        horaInicio: turmaSelecionada?.horaInicio ?? null,
        horaFim: turmaSelecionada?.horaFim ?? null,
        plano: m.plano
          ? {
              nome: m.plano.nome,
              valor: Number(m.plano.valor),
              periodicidade: m.plano.periodicidade,
            }
          : null,
        cobrancas: {
          pendentes: m.cobrancas.length,
          totalPendente: Number(m.cobrancas.reduce((sum, c) => sum + Number(c.valor), 0)),
        },
      };
    });

    // 6. Retornar dados
    return NextResponse.json(
      portalMatriculasResultDTOSchema.parse(
        mapPortalMatriculasResultToDTO({
          matriculas: matriculasFormatadas.map((matricula) => mapPortalMatriculaToDTO(matricula)),
        }),
      ),
    );
  } catch (error) {
    console.error('Erro ao buscar matrículas:', error);
    return NextResponse.json({ error: 'Erro ao carregar matrículas' }, { status: 500 });
  }
}
