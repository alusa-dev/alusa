import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listActiveAccountsForUser } from '@/src/server/users/account-access.service';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const memberships = await listActiveAccountsForUser(userId);
  return NextResponse.json({
    activeContaId: session.user.contaId,
    accounts: memberships.map(({ contaId, role, conta }) => ({ id: contaId, name: conta.nome, role })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
