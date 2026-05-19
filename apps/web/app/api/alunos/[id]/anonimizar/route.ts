import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { anonimizarAluno } from '@alusa/lib';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; contaId?: string; role?: string } })?.user;
    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    if (String(user.role || '').toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const motivo = typeof body?.motivo === 'string' ? body.motivo : undefined;

    const aluno = await anonimizarAluno({
      id: rawParams.id,
      contaId: user.contaId,
      motivo,
      actorId: user.id,
    });

    return NextResponse.json({ success: true, aluno });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'Erro ao anonimizar aluno' },
      { status: 400 },
    );
  }
}
