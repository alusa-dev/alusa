import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    const contaId = (session as { user?: { contaId?: string } })?.user?.contaId;
    if (!contaId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const responsavelId = params.id;

    // Validate responsável belongs to this conta (multi-tenant)
    const responsavel = await prisma.responsavel.findFirst({
      where: { id: responsavelId, contaId },
      select: { id: true },
    });

    if (!responsavel) {
      return NextResponse.json({ error: 'Responsável não encontrado' }, { status: 404 });
    }

    const vinculos = await prisma.alunoResponsavel.findMany({
      where: { responsavelId },
      select: {
        aluno: {
          select: {
            id: true,
            nome: true,
            dataNasc: true,
            cpf: true,
            foto: true,
            status: true,
          },
        },
      },
    });

    const items = vinculos.map(({ aluno }) => ({
      id: aluno.id,
      nome: aluno.nome,
      dataNasc: aluno.dataNasc ? aluno.dataNasc.toISOString() : null,
      cpf: aluno.cpf ?? null,
      foto: aluno.foto ?? null,
      ativo: aluno.status === 'ATIVO',
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error('[GET /api/responsaveis/[id]/alunos]', error);
    return NextResponse.json({ error: 'Erro ao buscar alunos do responsável' }, { status: 500 });
  }
}
