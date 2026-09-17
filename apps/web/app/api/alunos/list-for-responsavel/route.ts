import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { listAlunosForResponsavelResultDTOSchema } from '@/features/cadastro/alunos/dtos';
import { mapAlunoForResponsavelToDTO } from '@/features/cadastro/alunos/mappers';
import { listAvailableStudentsForResponsible } from '@/src/server/alunos/available-for-responsible.service';

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Apenas ADMIN pode acessar
    if (auth.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    const contaId = auth.contaId;

    // Buscar alunos que ainda não têm usuário vinculado ou não têm responsável
    const alunos = await listAvailableStudentsForResponsible(contaId);

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
