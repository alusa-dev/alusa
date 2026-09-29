import { Suspense } from 'react';

import { ReportsPage } from '@/features/finance/operations/reports/ReportsPage';

export default function FinanceiroRelatoriosPage() {
  return (
    <Suspense fallback={<div className="alusa-session-panel h-96 animate-pulse" />}>
      <ReportsPage />
    </Suspense>
  );
}
