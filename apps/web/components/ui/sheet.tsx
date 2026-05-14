import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 alusa-overlay-soft bg-slate-950/30 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

const sheetVariants = {
  right:
    'fixed inset-y-0 right-0 z-50 h-full w-full border-l border-slate-200 bg-white alusa-sheet-surface shadow-2xl sm:max-w-xl',
  left:
    'fixed inset-y-0 left-0 z-50 h-full w-full border-r border-slate-200 bg-white alusa-sheet-surface shadow-2xl sm:max-w-xl',
};

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: keyof typeof sheetVariants;
  }
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        sheetVariants[side],
        'outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-within:ring-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right-2 data-[state=closed]:slide-out-to-right-2',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="alusa-sheet-close-btn absolute right-4 top-4 rounded-full p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900">
        <X className="h-4 w-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = DialogPrimitive.Content.displayName;

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('alusa-sheet-header flex flex-col space-y-1.5 border-b border-slate-100 px-6 py-5', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('alusa-sheet-footer mt-auto flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4', className)} {...props} />
);
SheetFooter.displayName = 'SheetFooter';

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('alusa-sheet-title text-lg font-semibold text-slate-900', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-slate-500', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
