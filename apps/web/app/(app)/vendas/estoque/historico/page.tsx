import { Suspense } from 'react';

import { InventoryHistoryFeature } from '@/features/vendas/InventoryHistoryFeature';

export default function EstoqueHistoricoPage() {
  return (
    <Suspense fallback={<div className="alusa-session-panel h-96 animate-pulse" />}>
      <InventoryHistoryFeature />
    </Suspense>
  );
}
