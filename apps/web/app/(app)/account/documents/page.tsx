'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Encaminha a área de documentos para a verificação da conta.
export default function DocumentosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/account/verification');
  }, [router]);
  return null;
}
