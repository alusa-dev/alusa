import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <section aria-busy className="flex flex-col gap-6 pb-8">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="min-h-[520px] w-full rounded-xl" />
    </section>
  );
}
