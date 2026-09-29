'use client';

import { useId, useState, type ReactNode } from 'react';
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

export interface ActionConfirmationDialogProps {
  open: boolean;
  title?: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onOpenChange: (_open: boolean) => void;
  children?: ReactNode;
}

export function ActionConfirmationDialog({
  open,
  title = 'Confirmar ação',
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  loadingLabel = 'Processando...',
  destructive = true,
  onConfirm,
  onOpenChange,
  children,
}: ActionConfirmationDialogProps) {
  const [loading, setLoading] = useState(false);
  const descriptionId = useId();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onOpenChange(false);
      }}
    >
      <AlertDialogContent
        overlayClassName="alusa-registration-wizard-overlay"
        aria-describedby={description ? descriptionId : undefined}
        className="max-w-[430px] gap-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-0 shadow-xl shadow-black/10 alusa-modal-surface alusa-wizard-corner-smoothing"
      >
        <div className="space-y-4 px-5 pb-5 pt-5 sm:px-6 sm:pb-5 sm:pt-6">
          <AlertDialogHeader className="space-y-2 text-left">
            {title ? (
              <AlertDialogTitle className="text-base font-semibold leading-6 text-slate-900">
                {title}
              </AlertDialogTitle>
            ) : null}
            <AlertDialogDescription
              id={description ? descriptionId : undefined}
              className="whitespace-pre-wrap text-sm leading-5 text-slate-600"
            >
              {description}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {children}
        </div>

        <AlertDialogFooter className="gap-2 bg-white px-5 pb-5 sm:space-x-0 sm:px-6 sm:pb-6">
          <AlertDialogCancel
            disabled={loading}
            onClick={() => !loading && onOpenChange(false)}
            className="mt-0 h-10 min-w-[112px] rounded-[10px] border-slate-200 text-slate-700 shadow-none hover:bg-slate-50"
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={async (event) => {
              event.preventDefault();
              if (loading) return;

              setLoading(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setLoading(false);
              }
            }}
            className={`h-10 min-w-[112px] rounded-[10px] shadow-none ${
              destructive
                ? 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500'
                : 'bg-[#7A1BFF] text-white shadow-sm hover:bg-[#6B1DF2] focus-visible:ring-[#7A1BFF]'
            }`}
          >
            {loading ? loadingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ActionConfirmationDialog;
