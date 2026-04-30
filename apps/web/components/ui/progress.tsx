"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  indicatorClassName?: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, indicatorClassName, value = 0, ...props }, ref) => {
    const v = clamp(value);
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v)}
        className={cn(
          "relative h-3 w-full overflow-hidden rounded-full bg-neutral-200",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "absolute left-0 top-0 h-full rounded-full bg-violet-600 transition-[width] duration-200",
            indicatorClassName
          )}
          style={{ width: `${v}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
