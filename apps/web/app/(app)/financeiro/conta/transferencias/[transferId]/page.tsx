import { Suspense } from 'react';

import { ContaTransferDetailPage } from '@/features/financeiro/conta';

export default async function Page({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;

  return (
    <Suspense>
      <ContaTransferDetailPage transferId={transferId} />
    </Suspense>
  );
}