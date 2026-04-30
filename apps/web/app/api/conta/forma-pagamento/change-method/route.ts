import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { contaBlockedActionResultDTOSchema } from '@/features/conta/dtos';

const BLOCKED_MESSAGE =
  'Alterações da forma de pagamento agora são realizadas exclusivamente pela secretaria da escola.';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const { id, role } = session.user as { id: string; role?: string };
  console.info(
    `[FormaPagamento][change-method] Bloqueado para o usuário ${id} (role: ${role ?? 'unknown'})`,
  );

  return NextResponse.json(contaBlockedActionResultDTOSchema.parse({ error: BLOCKED_MESSAGE }), {
    status: 403,
  });
}





