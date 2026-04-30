import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { contaBlockedActionResultDTOSchema } from '@/features/conta/dtos';

const BLOCKED_MESSAGE =
  'A validação e cadastro de cartões são realizados pelo time financeiro da escola para manter a segurança dos dados.';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { id, role } = session.user as { id: string; role?: string };
  console.info(
    `[FormaPagamento][validate-card] Bloqueado para o usuário ${id} (role: ${role ?? 'unknown'})`,
  );

  return NextResponse.json(contaBlockedActionResultDTOSchema.parse({ error: BLOCKED_MESSAGE }), {
    status: 403,
  });
}





