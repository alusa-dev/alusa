'use client';

import Image from 'next/image';

import { Progress } from '@/components/ui/progress';

export function MapEditorLoading({ label = 'Carregando editor do mapa' }: { label?: string }) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-[#f8f7fb] px-6">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <Image src="/brand/logo.svg" alt="Alusa" width={150} height={48} priority />
        <div className="mt-8 w-full rounded-full bg-white p-1 shadow-sm shadow-slate-200/70">
          <Progress value={72} className="h-2" />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-600">{label}</p>
      </div>
    </main>
  );
}
