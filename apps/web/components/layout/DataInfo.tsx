import React from 'react';
import { cn } from '@/lib/cn';

interface DataInfoProps {
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  helper?: string;
  className?: string;
}

export function DataInfo({ icon: Icon, label, value, helper, className }: DataInfoProps) {
  return (
    <div className={cn('rounded-xl border bg-white px-4 py-3 flex items-center gap-4', className)}>
      {Icon ? (
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 text-purple-600">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-base font-semibold text-gray-900">{value}</span>
        {helper ? <span className="text-xs text-gray-500">{helper}</span> : null}
      </div>
    </div>
  );
}
