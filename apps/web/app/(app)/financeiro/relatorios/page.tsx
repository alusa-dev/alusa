import { Suspense } from 'react';

import { RelatoriosPage } from '@/features/financeiro/relatorios/RelatoriosPage';

export default function FinanceiroRelatoriosPage() {
  return (
    <Suspense fallback={<div className="alusa-session-panel h-96 animate-pulse" />}>
      <RelatoriosPage />
    </Suspense>
  );
}
