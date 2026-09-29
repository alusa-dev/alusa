'use client';

import { AlertCircle, Refresh } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';

export function ReportsErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="alusa-session-panel flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-red-50 text-red-600 alusa-dark:bg-red-950/30">
        <AlertCircle className="h-5 w-5" />
      </span>
      <h2 className="mt-3 text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Não foi possível carregar o relatório</h2>
      <p className="mt-1 max-w-md text-sm text-gray-500">{message}</p>
      <Button className="mt-4" variant="outline" onClick={onRetry}><Refresh className="h-4 w-4" />Tentar novamente</Button>
    </div>
  );
}

