'use client';

import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type FieldHelpTooltipProps = {
  content: React.ReactNode;
  className?: string;
  label?: string;
};

export function FieldHelpTooltip({ content, className, label = 'Ajuda' }: FieldHelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const openedByPointer = useRef(false);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip
        open={open}
        onOpenChange={(next) => {
          if (next && !openedByPointer.current) return;
          setOpen(next);
        }}
      >
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            tabIndex={-1}
            onPointerEnter={() => {
              openedByPointer.current = true;
              setOpen(true);
            }}
            onPointerLeave={() => {
              openedByPointer.current = false;
              setOpen(false);
            }}
            className={cn(
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
              className,
            )}
          >
            <CircleAlert className="h-3.5 w-3.5" strokeWidth={2.25} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-left leading-relaxed">{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
