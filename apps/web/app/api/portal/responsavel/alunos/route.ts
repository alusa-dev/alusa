import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  calculatePortalAge,
  requirePortalUser,
} from '@/features/portal/api-helpers';
import { portalResponsavelAlunosResultDTOSchema } from '@/features/portal/dtos';
import {
  mapPortalResponsavelAlunoToDTO,
  mapPortalResponsavelAlunosResultToDTO,
} from '@/features/portal/mappers';

export async function GET() {
  try {
    const auth = await requirePortalUser('RESPONSAVEL');
    if ('response' in auth) return auth.response;
    const { user } = auth;

    // 3. Buscar alunos vinculados ao responsável - Multi-tenant: filtrar por contaId
    const responsavel = await prisma.responsavel.findFirst({
      where: {
        usuarioId: user.id,
        contaId: user.contaId,
      },
      include: {
        alunos: {
          include: {
            aluno: {
              select: {
                id: true,
                nome: true,
                foto: true,
                dataNasc: true,
              },
            },
          },
        },
      },
    });

    if (!responsavel) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    // 5. Formatar dados
    const alunos = responsavel.alunos.map((ar) => ({
      id: ar.aluno.id,
      nome: ar.aluno.nome,
      foto: ar.aluno.foto,
      idade: calculatePortalAge(ar.aluno.dataNasc),
    }));

    // 6. Retornar dados
    return NextResponse.json(
      portalResponsavelAlunosResultDTOSchema.parse(
        mapPortalResponsavelAlunosResultToDTO({
          alunos: alunos.map((aluno) => mapPortalResponsavelAlunoToDTO(aluno)),
        }),
      ),
    );
  } catch (error) {
    console.error('Erro ao buscar alunos do responsável:', error);
    return NextResponse.json(
      { error: 'Erro ao carregar alunos' },
      { status: 500 },
    );
  }
}


