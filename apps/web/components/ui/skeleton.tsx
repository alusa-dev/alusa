import * as React from 'react';
import { cn } from '@/lib/cn';

export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('animate-pulse rounded-md bg-gray-200', className)} {...props} />
);
