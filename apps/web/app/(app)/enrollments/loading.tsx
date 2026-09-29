import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <section aria-busy className="flex flex-col gap-6 pb-8">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="min-h-[420px] w-full rounded-xl" />
    </section>
  );
}
