import { Suspense } from 'react';

import { AccountTransferDetailPage } from '@/features/finance/operations/account';

export default async function Page({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;

  return (
    <Suspense>
      <AccountTransferDetailPage transferId={transferId} />
    </Suspense>
  );
}
