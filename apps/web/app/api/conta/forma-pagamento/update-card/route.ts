import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { contaBlockedActionResultDTOSchema } from '@/features/account/dtos';

const BLOCKED_MESSAGE =
  'Atualizações de cartão precisam ser solicitadas diretamente à secretaria para garantirmos segurança e sincronização correta.';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  return NextResponse.json(contaBlockedActionResultDTOSchema.parse({ error: BLOCKED_MESSAGE }), {
    status: 403,
  });
}




