import type { Metadata } from 'next';

import { LoadingDots } from '@/components/ui/LoadingDots';

export const metadata: Metadata = {
  title: 'Component Preview',
};

export default function ComponentPreviewPage() {
  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-gray-50 p-6">
      <div className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex h-48 items-center justify-center rounded-2xl border border-gray-200 bg-white">
          <LoadingDots label="Carregando pré-visualização em fundo branco" />
        </div>
        <div className="flex h-48 items-center justify-center rounded-2xl bg-black">
          <LoadingDots label="Carregando pré-visualização em fundo preto" />
        </div>
      </div>
    </main>
  );
}
