import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>

      <div className="bg-white rounded-xl border p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="flex w-full md:w-auto items-center gap-3">
            <Skeleton className="h-9 w-[180px]" />
            <Skeleton className="h-9 w-[320px]" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="bg-gray-50 px-6 py-3 border-b">
          <div className="grid grid-cols-12 gap-4">
            <Skeleton className="col-span-3 h-4" />
            <Skeleton className="col-span-2 h-4" />
            <Skeleton className="col-span-3 h-4" />
            <Skeleton className="col-span-2 h-4" />
            <Skeleton className="col-span-2 h-4" />
          </div>
        </div>

        {[...Array(5)].map((_, i) => (
          <div key={i} className="px-6 py-3">
            <div className="grid grid-cols-12 gap-4 items-center">
              <div className="col-span-3 flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
              <Skeleton className="col-span-2 h-4 w-28" />
              <Skeleton className="col-span-3 h-4 w-56" />
              <Skeleton className="col-span-2 h-4 w-32" />
              <Skeleton className="col-span-2 h-8 w-8 rounded-md justify-self-end" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
