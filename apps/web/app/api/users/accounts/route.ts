import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { listAuthContextAccounts } from '@/lib/auth-service';

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const authContext = session.user.authContext;
  if (!authContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accounts = await listAuthContextAccounts(userId, authContext);
  return NextResponse.json({
    activeContaId: session.user.contaId,
    accounts,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
