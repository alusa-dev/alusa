'use client';

import { Suspense } from 'react';

import { ContaPage } from '@/features/financeiro/conta';

export default function Page() {
  return (
    <Suspense>
      <ContaPage />
    </Suspense>
  );
}