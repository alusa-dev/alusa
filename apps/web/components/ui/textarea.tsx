/* eslint-disable react/prop-types */
import * as React from 'react';
import { cn } from '@/lib/cn';

type nativeProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
const Textarea = React.forwardRef<HTMLTextAreaElement, nativeProps>((props, ref) => {
  const { className, ...rest } = props;
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...rest}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
