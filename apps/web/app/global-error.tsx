'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="bg-white text-gray-900 antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-lg font-semibold">Ocorreu um erro inesperado.</h1>
          <p className="max-w-md text-sm text-gray-600">
            Tente recarregar a página. Se o problema persistir, verifique os logs com o digest deste erro.
          </p>
          {error.digest ? (
            <p className="text-xs text-gray-500">Digest: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
