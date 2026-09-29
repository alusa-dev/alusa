import { getServerSession } from 'next-auth';
import { permanentRedirect, redirect } from 'next/navigation';

import { authOptions } from '@/lib/auth-options';

export default async function LegacyFinanceAccountPage() {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; role?: string } } | null)?.user;

  if (!user?.id) {
    redirect('/auth/login');
  }

  if (user.role?.toUpperCase() !== 'ADMIN') {
    redirect('/dashboard');
  }

  permanentRedirect('/account/profile');
}
