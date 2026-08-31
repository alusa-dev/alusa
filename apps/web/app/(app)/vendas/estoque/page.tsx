import { Suspense } from 'react';

import { InventoryFeature } from '@/features/vendas/InventoryFeature';

export default function EstoquePage() {
  return (
    <Suspense fallback={<div className="alusa-session-panel h-96 animate-pulse" />}>
      <InventoryFeature />
    </Suspense>
  );
}
