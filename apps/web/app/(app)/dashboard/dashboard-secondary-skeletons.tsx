import { Skeleton } from '@/components/ui/skeleton';

import { DASHBOARD_SECTION_CARD_CLASSNAME } from './components/utils';

/** Skeleton da área inferior (tabelas) — mesmo grid da versão carregada. */
export function DashboardSecondarySkeleton() {
  return (
    <div className="mb-6 grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-4">
      <div
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} md:col-span-2 lg:col-span-3 rounded-2xl bg-white p-6 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <Skeleton className="mb-5 h-5 w-40" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} md:col-span-2 lg:col-span-1 rounded-2xl bg-white p-5 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <Skeleton className="mb-5 h-5 w-36" />
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Fallback enquanto o chunk de `DashboardSecondarySection` carrega (next/dynamic). */
export function DashboardSecondaryChunkSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="h-[260px]">
            <Skeleton className="h-full w-full rounded-2xl" />
          </div>
        ))}
      </div>
      <DashboardSecondarySkeleton />
    </div>
  );
}
