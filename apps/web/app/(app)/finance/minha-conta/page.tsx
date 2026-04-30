import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';

export default async function FinanceMinhaContaPage() {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; role?: string; contaId?: string } } | null)?.user;

  if (!user?.id) {
    redirect('/auth/login');
  }

  const role = user.role?.toUpperCase();
  if (role !== 'ADMIN') {
    redirect('/dashboard');
  }

  redirect('/conta/perfil');
}
