import { TableLayout } from '@/components/layout/TableLayout';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <TableLayout
      title="Agenda"
      subtitle="Calendário centralizado da escola, com visão operacional por ocorrência."
      className="pr-4 xl:pr-6"
    >
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-10 w-[200px] rounded-xl" />
            <Skeleton className="h-9 w-[280px] rounded-lg" />
          </div>
          <div className="flex flex-col gap-2 xl:items-end">
            <Skeleton className="h-9 w-full max-w-xs xl:w-[320px]" />
            <Skeleton className="h-9 w-full max-w-xs xl:w-[280px]" />
          </div>
        </div>
        <div className="min-h-[420px] px-6 py-10">
          <Skeleton className="h-full min-h-[380px] w-full rounded-xl" />
        </div>
      </div>
    </TableLayout>
  );
}
