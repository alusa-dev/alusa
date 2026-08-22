'use client';

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export const detailsDialogSectionClass = 'space-y-3 rounded-xl bg-slate-50 px-4 py-4';

type DetailsDialogProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function DetailsDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: DetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-[30rem] flex-col gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-2xl">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-slate-200 bg-white px-6 pb-5 pt-6 pr-14">
            <DialogTitle className="text-lg font-medium tracking-tight text-slate-900">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto scroll-smooth bg-white px-6 py-6">
            {children}
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
            {footer ?? (
              <Button
                type="button"
                variant="outline"
                className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => onOpenChange(false)}
              >
                Fechar
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DetailsDialogSection({ children }: { children: ReactNode }) {
  return <section className={detailsDialogSectionClass}>{children}</section>;
}

export function DetailsDialogRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5" data-testid="detail-row">
      <div className="w-[48%] text-xs font-medium text-slate-500">{label}</div>
      <div className="w-[52%] text-left text-sm text-slate-900">{value}</div>
    </div>
  );
}
