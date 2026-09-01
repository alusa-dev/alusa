'use client';

import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';

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
  description: ReactNode;
};

const WELCOME_STEPS: WelcomeStep[] = [
  {
    title: 'Sua operação começa aqui',
    description: (
      <>
        A Alusa reúne a rotina da sua escola em um só lugar,
        <br />
        para deixar o dia a dia mais simples, organizado e tranquilo.
      </>
    ),
  },
];

const welcomePanelVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.985,
    y: 8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  },
  exiting: {
    opacity: 0,
    scale: 0.985,
    y: 8,
    transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
  },
};

export function WelcomeWizardDialog({
  open,
  userName: _userName,
  onComplete,
}: WelcomeWizardDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const step = WELCOME_STEPS[0];

  const handleAdvance = async () => {
    if (submitting) return;

    try {
      setSubmitting(true);
      setIsExiting(true);
      await new Promise((resolve) => window.setTimeout(resolve, 240));
      await onComplete();
    } finally {
      setSubmitting(false);
      setIsExiting(false);
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
        unstyled
        overlayClass="bg-black/80 backdrop-blur-sm supports-[backdrop-filter]:backdrop-blur-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className={`max-w-[640px] !transition-none data-[state=closed]:!animate-none data-[state=open]:!animate-none [&>button.absolute]:z-20 [&>button.absolute]:text-white [&>button.absolute:hover]:opacity-100 ${
          isExiting ? '[&>button.absolute]:pointer-events-none [&>button.absolute]:opacity-0' : ''
        }`}
      >
        <AnimatePresence initial={false} mode="wait">
          {!isExiting && (
            <motion.div
              key="welcome-panel"
              variants={welcomePanelVariants}
              initial="hidden"
              animate="visible"
              exit="exiting"
              className="flex min-h-[500px] select-none flex-col overflow-hidden rounded-[24px] border-0 bg-white shadow-[0_12px_32px_rgba(0,0,0,0.28),0_2px_8px_rgba(0,0,0,0.16)]"
            >
              <div className="relative overflow-hidden bg-[#43206d]">
                <div className="relative aspect-[1600/880] w-full bg-[radial-gradient(circle_at_top,rgba(123,86,184,0.18),transparent_52%),linear-gradient(135deg,#f8f4ff_0%,#f2ebff_52%,#efe8ff_100%)]">
                  <img
                    src="/images/onboarding/alusa-welcome.png"
                    alt="Bem-vindo à Alusa"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>

                <DialogHeader className="items-center space-y-0 bg-white px-6 pt-5 text-center sm:px-7 sm:pt-6">
                  <DialogTitle className="max-w-[28ch] text-center text-[1.2rem] font-semibold leading-snug tracking-[-0.025em] text-slate-900 sm:max-w-none sm:text-[1.3rem]">
                    Que bom ter você por aqui!
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
                    Começar minha jornada
                  </Button>
                </div>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

export default WelcomeWizardDialog;
