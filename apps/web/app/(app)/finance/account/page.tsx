'use client';

import { Suspense } from 'react';

import { AccountPage } from '@/features/finance/operations/account';

export default function Page() {
  return (
    <Suspense>
      <AccountPage />
    </Suspense>
  );
}
