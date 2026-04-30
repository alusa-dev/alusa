import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { listAlunosForResponsavelResultDTOSchema } from '@/features/cadastro/alunos/dtos';
import { mapAlunoForResponsavelToDTO } from '@/features/cadastro/alunos/mappers';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const sessionUser = session.user as { role?: string; contaId?: string };
    const userRole = sessionUser.role;
    const contaId = sessionUser.contaId;

    // Apenas ADMIN pode acessar
    if (userRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    if (!contaId) {
      return NextResponse.json({ error: 'Conta não identificada' }, { status: 400 });
    }

    // Buscar alunos que ainda não têm usuário vinculado ou não têm responsável
    const alunos = await prisma.aluno.findMany({
      where: {
        contaId,
        status: 'ATIVO',
        // Buscar alunos sem usuário vinculado (para não duplicar acesso)
        usuarioId: null,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        dataNasc: true,
      },
      orderBy: {
        nome: 'asc',
      },
    });

    // Formatar resposta
    const alunosFormatados = alunos.map((aluno) => ({
      id: aluno.id,
      nome: aluno.nome,
      email: aluno.email || null,
      idade: aluno.dataNasc ? calcularIdade(aluno.dataNasc) : null,
    }));

    return NextResponse.json(
      listAlunosForResponsavelResultDTOSchema.parse({
        alunos: alunosFormatados.map((aluno) => mapAlunoForResponsavelToDTO(aluno)),
      }),
    );
  } catch (error) {
    console.error('[alunos/list-for-responsavel] Error:', error);
    return NextResponse.json({ error: 'Erro ao buscar alunos' }, { status: 500 });
  }
}

function calcularIdade(dataNasc: Date): number {
  const hoje = new Date();
  const nascimento = new Date(dataNasc);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }
  return idade;
}

