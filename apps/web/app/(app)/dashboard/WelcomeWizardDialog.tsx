'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type WelcomeWizardDialogProps = {
  open: boolean;
  userName?: string | null;
  onComplete: () => Promise<void>;
};

type WelcomeStep = {
  title: string;
  description: string;
  imageHint: string;
};

const WELCOME_STEPS: WelcomeStep[] = [
  {
    title: 'Sua operação começa aqui',
    description:
      'A Alusa reúne a rotina acadêmica e financeira da sua escola em um painel único, claro e pronto para o dia a dia.',
    imageHint: '(adicione uma imagem em dev)',
  },
];

export function WelcomeWizardDialog({ open, userName: _userName, onComplete }: WelcomeWizardDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const step = WELCOME_STEPS[0];

  const handleAdvance = async () => {
    try {
      setSubmitting(true);
      await onComplete();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) void onComplete();
      }}
    >
      <DialogContent
        fullScreenMobile
        overlayClass="bg-black/80 backdrop-blur-sm supports-[backdrop-filter]:backdrop-blur-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="max-w-[640px] overflow-hidden rounded-[24px] !border-0 bg-[#43206d] p-0 !shadow-[0_12px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.16)] !transition-none hover:!shadow-[0_12px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.16)] focus:!shadow-[0_12px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.16)] active:!shadow-[0_12px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.16)] [&>button.absolute]:text-white [&>button.absolute:hover]:opacity-100"
      >
        <div className="flex min-h-[500px] select-none flex-col">
          <div className="relative overflow-hidden">
            <div className="relative aspect-[1600/880] w-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(123,86,184,0.18),transparent_52%),linear-gradient(135deg,#f8f4ff_0%,#f2ebff_52%,#efe8ff_100%)]">
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_40%,rgba(91,47,167,0.06)_100%)]" />
              <div className="absolute inset-0 flex items-center justify-center text-center">
                <div className="space-y-1 px-6">
                  <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-[#7b56b8]">
                    imagem
                  </p>
                  <p className="text-sm text-slate-500/90">{step.imageHint}</p>
                </div>
              </div>
            </div>

            <DialogHeader className="items-center space-y-0 bg-white px-6 pt-5 text-center sm:px-7 sm:pt-6">
              <DialogTitle className="max-w-[28ch] text-center text-[1.2rem] font-semibold leading-snug tracking-[-0.025em] text-slate-900 sm:max-w-none sm:text-[1.3rem]">
                Seja bem-vindo(a) à Alusa!
              </DialogTitle>

              <DialogDescription className="mx-auto max-w-[31rem] pt-2 text-pretty text-center text-[13px] leading-5 text-slate-500 sm:text-[14px] sm:leading-[1.45]">
                {step.description}
              </DialogDescription>
            </DialogHeader>
          </div>

          <DialogFooter className="mt-auto w-full bg-white px-6 pb-6 pt-5 sm:px-7 sm:pt-6">
            <div className="flex w-full items-center justify-center">
              <Button
                type="button"
                onClick={() => void handleAdvance()}
                disabled={submitting}
                className="h-10 min-w-[160px] bg-brand-accent px-5 text-white shadow-none hover:bg-brand-accent/90"
              >
                Ir para o dashboard
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WelcomeWizardDialog;
