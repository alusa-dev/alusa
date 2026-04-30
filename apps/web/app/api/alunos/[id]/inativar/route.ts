import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { inativarAluno } from '@alusa/lib';
import { z } from 'zod';

const inativarSchema = z.object({
  motivo: z.string().min(10, 'Motivo deve ter no mínimo 10 caracteres'),
  acao: z.enum(['PAUSAR', 'CANCELAR'], {
    errorMap: () => ({ message: 'Ação deve ser PAUSAR ou CANCELAR' }),
  }),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 1. Autenticação
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // 2. Autorização (apenas ADMIN ou GESTOR)
    if (!['ADMIN', 'GESTOR'].includes(session.user.role)) {
      return NextResponse.json(
        { error: 'Apenas ADMIN ou GESTOR podem inativar alunos' },
        { status: 403 },
      );
    }

    // 3. Validar input
    const body = await req.json();
    const parsed = inativarSchema.parse(body);

    // 4. Validar contaId
    if (!session.user.contaId) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 400 });
    }

    // 5. Inativar aluno
    const result = await inativarAluno({
      id: params.id,
      contaId: session.user.contaId,
      motivo: parsed.motivo,
      acao: parsed.acao,
      actorId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Erro ao inativar aluno:', error);

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
