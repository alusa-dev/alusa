import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import type { ReactNode } from 'react';

import { authOptions } from '@/lib/auth-options';

export default async function FinanceiroLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: { id?: string; role?: string; contaId?: string } } | null)?.user;

  if (!user?.id) {
    redirect('/auth/login');
  }

  const role = user.role?.toUpperCase();
  const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
  if (!role || !allowedRoles.has(role)) {
    redirect('/dashboard');
  }

  return children;
}
