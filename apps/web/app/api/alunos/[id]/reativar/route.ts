import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { reativarAlunoCompleto } from '@alusa/lib';
import { z } from 'zod';

const reativarSchema = z.object({
  reativarMatriculas: z.boolean().optional().default(false),
  matriculasIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    // 1. Autenticação
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Autorização (apenas ADMIN ou GESTOR)
    if (!['ADMIN', 'GESTOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'Apenas ADMIN ou GESTOR podem reativar alunos' },
        { status: 403 },
      );
    }

    // 3. Validar input
    const body = await req.json();
    const parsed = reativarSchema.parse(body);

    // 4. Validar contaId
    if (!session.user.contaId) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 400 });
    }

    // 5. Reativar aluno
    const result = await reativarAlunoCompleto({
      id: rawParams.id,
      contaId: session.user.contaId,
      reativarMatriculas: parsed.reativarMatriculas,
      matriculasIds: parsed.matriculasIds,
      actorId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Erro ao reativar aluno:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Dados inválidos', details: error.errors },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
