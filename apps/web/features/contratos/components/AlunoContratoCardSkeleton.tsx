import { Skeleton } from '@/components/ui/skeleton';

export function AlunoContratoCardSkeleton() {
  return (
    <div className="flex w-full items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-4">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-[220px] rounded" />
          <Skeleton className="h-3 w-[120px] rounded" />
        </div>
      </div>
      <Skeleton className="h-5 w-5 rounded" />
    </div>
  );
}
