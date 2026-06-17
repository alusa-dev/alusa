'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

/**
 * Auth de página já é garantida pelo middleware (/financeiro/*).
 * Role gate client-side evita getServerSession bloqueante no TTFB do documento.
 */
export default function FinanceiroLayout({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    if (!session?.user?.id) {
      router.replace('/auth/login');
      return;
    }

    const role = session.user.role?.toUpperCase();
    if (!role || !allowedRoles.has(role)) {
      router.replace('/dashboard');
    }
  }, [router, session, status]);

  return children;
}
