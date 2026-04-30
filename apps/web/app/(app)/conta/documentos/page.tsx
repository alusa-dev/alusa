'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect permanente para /conta/verificacao
export default function DocumentosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/conta/verificacao');
  }, [router]);
  return null;
}
