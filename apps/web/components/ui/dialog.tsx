'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';
import { X } from '@/components/icons/icons';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Fullscreen backdrop + flex para centralizar o conteúdo sem depender de translate
      'fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 md:p-6',
      // Blur suave (fallback para navegadores sem suporte)
      'backdrop-blur-sm supports-[backdrop-filter]:backdrop-blur-md',
      // Fade animations
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /** Conteúdo ocupa a viewport no mobile (sem margens); desktop inalterado. */
  fullScreenMobile?: boolean;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, fullScreenMobile, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={cn(fullScreenMobile && 'max-md:p-0')} />
    {/* Wrapper flex para centralização perfeita e suportar scroll em telas baixas */}
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 overflow-y-auto',
        fullScreenMobile && 'max-md:overflow-hidden max-md:p-0',
      )}
    >
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'relative z-50 grid w-full max-w-lg gap-4 border bg-white p-6 shadow-lg outline-none sm:rounded-xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          fullScreenMobile &&
            'max-md:box-border max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-full max-md:max-w-none max-md:min-h-0 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:border-b-0 max-md:shadow-none max-md:pb-[env(safe-area-inset-bottom,0px)] max-md:pl-[env(safe-area-inset-left,0px)] max-md:pr-[env(safe-area-inset-right,0px)]',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/50 disabled:pointer-events-none',
            fullScreenMobile &&
              'max-md:right-4 max-md:top-[calc(0.5rem+env(safe-area-inset-top,0px))] max-md:z-10 max-md:rounded-md max-md:bg-slate-50/90 max-md:p-1.5 max-md:ring-1 max-md:ring-slate-200/80',
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
