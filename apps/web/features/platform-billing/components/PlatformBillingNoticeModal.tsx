'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export type PlatformBillingNotice = {
  key: string;
  title: string;
  description: string;
  actionLabel: string;
  tone?: 'default' | 'destructive';
};

export function PlatformBillingNoticeModal({
  notice,
  open,
  onOpenChange,
  onAction,
}: {
  notice: PlatformBillingNotice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: () => void;
}) {
  if (!notice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenMobile
        unstyled
        overlayClass="bg-black/80 backdrop-blur-sm supports-[backdrop-filter]:backdrop-blur-md"
        className="max-w-[640px] !transition-none data-[state=closed]:!animate-none data-[state=open]:!animate-none [&>button.absolute]:z-20 [&>button.absolute]:text-white [&>button.absolute:hover]:opacity-100"
      >
        <div className="flex min-h-[500px] select-none flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.16)]">
          <div className="relative overflow-hidden bg-[#43206d]">
            <div className="relative aspect-[1600/880] w-full bg-[radial-gradient(circle_at_top,rgba(123,86,184,0.18),transparent_52%),linear-gradient(135deg,#f8f4ff_0%,#f2ebff_52%,#efe8ff_100%)]">
              <img src="/images/onboarding/alusa-welcome.png" alt="Informação sobre o plano da Alusa" className="absolute inset-0 h-full w-full object-cover" />
            </div>
            <DialogHeader className="items-center space-y-0 bg-white px-6 pt-5 text-center sm:px-7 sm:pt-6">
              <DialogTitle className="max-w-[28ch] text-center text-[1.2rem] font-semibold leading-snug tracking-[-0.025em] text-slate-900 sm:max-w-none sm:text-[1.3rem]">
                {notice.title}
              </DialogTitle>
              <DialogDescription className="mx-auto max-w-[31rem] pt-2 text-pretty text-center text-[13px] leading-5 text-slate-500 sm:text-[14px] sm:leading-[1.45]">
                {notice.description}
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="mt-auto w-full bg-white px-6 pb-6 pt-5 sm:px-7 sm:pt-6">
            <div className="flex w-full items-center justify-center">
              <Button
                type="button"
                onClick={onAction}
                className={notice.tone === 'destructive' ? 'h-10 min-w-[180px] bg-red-600 px-5 text-white shadow-none hover:bg-red-700' : 'h-10 min-w-[180px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90'}
              >
                {notice.actionLabel}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
