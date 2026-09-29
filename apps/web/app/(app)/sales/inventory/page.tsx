import { Suspense } from 'react';

import { InventoryFeature } from '@/features/sales/InventoryFeature';

export default function EstoquePage() {
  return (
    <Suspense fallback={<div className="alusa-session-panel h-96 animate-pulse" />}>
      <InventoryFeature />
    </Suspense>
  );
}
