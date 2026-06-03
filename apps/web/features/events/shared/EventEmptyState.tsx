'use client';

export function EventEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}
