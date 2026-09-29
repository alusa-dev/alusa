'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SituacaoCadastralRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/account/verification'); }, [router]);
  return null;
}
