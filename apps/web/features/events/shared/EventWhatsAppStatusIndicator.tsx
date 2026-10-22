'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  AlertCircleIcon,
  Clock03Icon,
  Loading03Icon,
  MinusSignIcon,
  Tick01Icon,
  TickDouble01Icon,
} from '@hugeicons/core-free-icons';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { getEventWhatsAppStatus } from './event-whatsapp-status';

const statusIcons = {
  clock: Clock03Icon,
  spinner: Loading03Icon,
  check: Tick01Icon,
  'double-check': TickDouble01Icon,
  alert: AlertCircleIcon,
  none: MinusSignIcon,
} as const;

const statusColors = {
  clock: 'text-slate-400',
  spinner: 'text-slate-500 motion-safe:animate-spin',
  check: 'text-slate-500',
  'double-check': 'text-slate-500',
  alert: 'text-rose-600',
  none: 'text-slate-400',
} as const;

export function EventWhatsAppStatusIndicator({ status }: { status?: string | null }) {
  const { label, icon, tone } = getEventWhatsAppStatus(status);
  const colorClass = tone === 'success' && status === 'READ' ? 'text-sky-600' : statusColors[icon];

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30"
          >
            <HugeiconsIcon
              aria-hidden="true"
              icon={statusIcons[icon]}
              size={18}
              strokeWidth={1.8}
              className={colorClass}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="border-transparent bg-[#19143A] text-slate-50 shadow-lg data-[state=delayed-open]:duration-150 data-[state=closed]:duration-100 data-[side=top]:slide-in-from-bottom-1 data-[side=top]:data-[state=closed]:slide-out-to-bottom-1 data-[side=bottom]:slide-in-from-top-1 data-[side=bottom]:data-[state=closed]:slide-out-to-top-1 motion-reduce:animate-none motion-reduce:duration-0"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-[#19143A]" width={10} height={5} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
