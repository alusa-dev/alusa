import { Skeleton } from '@/components/ui/skeleton';

export function PessoaNotaFiscalCardSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 lg:rounded-2xl lg:px-5 lg:py-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full lg:h-11 lg:w-11" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-6 w-24" />
    </div>
  );
}
