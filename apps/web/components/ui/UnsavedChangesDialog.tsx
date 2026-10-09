'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { MouseEvent } from 'react';

export interface UnsavedChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  title?: string;
  description?: string;
  discardText?: string;
  keepEditingText?: string;
  className?: string;
}

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onDiscard,
  title = 'Descartar cadastro?',
  description = 'Existem informações não salvas. Se você sair agora, todos os dados digitados serão perdidos.',
  discardText = 'Descartar',
  keepEditingText = 'Continuar preenchendo',
  className,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <>
        <AlertDialogContent
          overlayClassName="bg-black/80 backdrop-blur-none"
          className={cn('alusa-unsaved-changes-dialog', className)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
              {description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              autoFocus
              className="border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-accent/40 alusa-dark:border-[color:var(--color-border-strong)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)]"
            >
              {keepEditingText}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event: MouseEvent) => {
                event.preventDefault();
                onOpenChange(false);
                onDiscard();
              }}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500/60"
            >
              {discardText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
        <style jsx global>{`
          @supports (corner-shape: superellipse(1.1)) {
            .alusa-unsaved-changes-dialog,
            .alusa-unsaved-changes-dialog :not(.rounded-full) {
              corner-shape: superellipse(1.1);
            }
          }
        `}</style>
      </>
    </AlertDialog>
  );
}
