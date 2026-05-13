'use client';

import * as Sentry from '@sentry/nextjs';
import { useState } from 'react';

/** Mesmo padrão do wizard Sentry: ReferenceError em runtime. */
function triggerUndefinedFunctionCall() {
  new Function('return myUndefinedFunction()')();
}

export function SentryExampleClient() {
  const [status, setStatus] = useState<string | null>(null);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Verificação Sentry</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Use os botões abaixo para enviar um evento de teste ao projeto{' '}
          <strong>javascript-nextjs</strong> (org <strong>alusa</strong>).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          onClick={() => {
            setStatus('Enviando exceção capturada…');
            Sentry.captureException(new Error('[Sentry verify] captureException'));
            setStatus('captureException disparado — confira Issues no Sentry em ~30s.');
          }}
        >
          Erro capturado (captureException)
        </button>

        <button
          type="button"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800"
          onClick={() => {
            setStatus('Disparando função inexistente…');
            triggerUndefinedFunctionCall();
          }}
        >
          Erro não tratado (como no wizard)
        </button>
      </div>

      {status ? <p className="text-sm text-gray-700 dark:text-gray-300">{status}</p> : null}
    </main>
  );
}
