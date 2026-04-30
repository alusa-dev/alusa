import React from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';

type SessionUser = { id?: string; role?: string };

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session?.user ?? null) as SessionUser | null;

  if (!user?.id) {
    redirect('/auth/login');
  }

  const role = (user.role ?? '').toUpperCase();
  if (role && role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return children;
}
